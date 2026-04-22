import { supabase } from "@/integrations/supabase/client";
import type { BatchRechnungDetail } from "@/lib/batches/batchTypes";
import { parseDetailJson } from "@/lib/batches/batchTypes";
import type { BulkAktion } from "@/lib/batches/bulkAktion";
import { kennFromLegacyPill } from "@/lib/batches/batchKennzeichnungDisplay";
import { downloadTextFile } from "@/lib/export";
import { rechnungsentwurfFromDetailJson } from "@/lib/rechnung/buildRechnungsentwurfFromBatch";
import {
  generateRechnungsentwuerfeStapelPdf,
  rechnungsentwuerfeToMultiCsv,
  rechnungsentwuerfeToMultiPad,
} from "@/lib/rechnung/rechnungsentwurfExport";
import type { Rechnungsentwurf } from "@/lib/rechnung/rechnungsentwurfTypes";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Zählt optimierbare Positionen und mögliches Betrags-Δ laut detail_json (Demo-/Wireframe-Struktur). */
export function countAenderungenFromDetail(detail: BatchRechnungDetail): { count: number; deltaEuro: number } {
  let count = 0;
  for (const p of detail.positionen) {
    const k = p.kennzeichnung ?? kennFromLegacyPill(p.pill);
    if (k !== "SICHER") count += 1;
  }
  const delta =
    detail.gesamtNach != null && detail.gesamt != null
      ? round2(Math.max(0, detail.gesamtNach - detail.gesamt))
      : 0;
  return { count, deltaEuro: delta };
}

export type BulkResult = {
  rechnungCount: number;
  aenderungenGesamt: number;
  betragDeltaSumme: number;
};

/**
 * Setzt vorschlaege_angenommen und abgeleitete Metriken in der DB.
 * Liefert aggregierte Werte für die Zusammenfassungs-Toast.
 */
export async function applyAcceptToRechnungIds(rechnungIds: string[]): Promise<BulkResult> {
  if (rechnungIds.length === 0) {
    return { rechnungCount: 0, aenderungenGesamt: 0, betragDeltaSumme: 0 };
  }
  const { data: rows, error } = await supabase
    .from("batch_rechnungen")
    .select("id, detail_json")
    .in("id", rechnungIds);
  if (error || !rows?.length) {
    console.error(error);
    return { rechnungCount: 0, aenderungenGesamt: 0, betragDeltaSumme: 0 };
  }
  let aenderungenGesamt = 0;
  let betragDeltaSumme = 0;
  for (const r of rows) {
    const detail = parseDetailJson(r.detail_json as Parameters<typeof parseDetailJson>[0]);
    const { count, deltaEuro } = countAenderungenFromDetail(detail);
    aenderungenGesamt += count;
    betragDeltaSumme = round2(betragDeltaSumme + deltaEuro);
    const { error: uErr } = await supabase
      .from("batch_rechnungen")
      .update({
        vorschlaege_angenommen: true,
        aenderungen_anzahl: count,
        optimierung_angewendet_euro: deltaEuro,
      })
      .eq("id", r.id);
    if (uErr) console.error(uErr);
  }
  return { rechnungCount: rows.length, aenderungenGesamt, betragDeltaSumme };
}

function entwurfMitOptionen(e: Rechnungsentwurf, begr: boolean, hinw: boolean): Rechnungsentwurf {
  let positionen = e.positionen;
  if (!begr) {
    positionen = positionen.map((p) => {
      const { begruendung: _b, ...rest } = p;
      return rest;
    });
  }
  return {
    ...e,
    positionen,
    hinweise: hinw ? e.hinweise : [],
    einwilligungsHinweise: hinw ? e.einwilligungsHinweise : [],
  };
}

async function resolveRechnungIds(aktion: BulkAktion): Promise<string[]> {
  if (aktion.rechnungIds.length > 0) return aktion.rechnungIds;
  if (aktion.type === "accept_all" || aktion.type === "export_all") {
    const { data, error } = await supabase.from("batch_rechnungen").select("id").eq("batch_id", aktion.batchId);
    if (error) {
      console.error(error);
      return [];
    }
    return (data ?? []).map((r) => (r as { id: string }).id);
  }
  return [];
}

export async function runBulkAktion(aktion: BulkAktion): Promise<BulkResult> {
  const ids = await resolveRechnungIds(aktion);
  if (aktion.type === "accept_all" || aktion.type === "accept_selected") {
    return applyAcceptToRechnungIds(ids);
  }
  if (aktion.type === "export_all" || aktion.type === "export_selected") {
    if (ids.length === 0) return { rechnungCount: 0, aenderungenGesamt: 0, betragDeltaSumme: 0 };
    const { data: rws, error } = await supabase
      .from("batch_rechnungen")
      .select("id, patient_id_label, betrag_euro, liste_status, fachbereich, detail_json, vorschlaege_angenommen")
      .in("id", ids);
    if (error || !rws?.length) {
      console.error(error);
      return { rechnungCount: 0, aenderungenGesamt: 0, betragDeltaSumme: 0 };
    }
    const fmt = aktion.optionen?.exportFormat ?? "csv";
    const begr = aktion.optionen?.includeBegruendungen !== false;
    const hinw = aktion.optionen?.includeHinweise !== false;
    const entwurfe: Rechnungsentwurf[] = rws.map((r) => {
      const o = r as Record<string, unknown>;
      const bet = typeof o.betrag_euro === "number" ? o.betrag_euro : Number(o.betrag_euro ?? 0);
      return entwurfMitOptionen(
        rechnungsentwurfFromDetailJson(
          String((o as { id: string }).id),
          aktion.batchId,
          String(o.patient_id_label ?? ""),
          bet,
          o.detail_json as Parameters<typeof rechnungsentwurfFromDetailJson>[4],
          { status: "exportiert" },
        ),
        begr,
        hinw,
      );
    });
    if (fmt === "csv") {
      downloadTextFile(
        `stapel-export-${aktion.batchId.slice(0, 8)}.csv`,
        rechnungsentwuerfeToMultiCsv(entwurfe),
        "text/csv;charset=utf-8",
      );
    } else if (fmt === "pad") {
      downloadTextFile(
        `stapel-${aktion.batchId.slice(0, 8)}.pad`,
        rechnungsentwuerfeToMultiPad(entwurfe),
        "text/plain;charset=utf-8",
      );
    } else {
      await generateRechnungsentwuerfeStapelPdf(
        entwurfe,
        "DocBill Stapel-Export (Rechnungsentwürfe, Spec 04)",
        `stapel-export-${aktion.batchId.slice(0, 8)}.pdf`,
      );
    }
    return { rechnungCount: rws.length, aenderungenGesamt: 0, betragDeltaSumme: 0 };
  }
  return { rechnungCount: 0, aenderungenGesamt: 0, betragDeltaSumme: 0 };
}
