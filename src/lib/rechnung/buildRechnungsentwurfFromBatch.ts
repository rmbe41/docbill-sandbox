import type { Regelwerk } from "@/lib/analyse/types";
import { kennFromLegacyPill } from "@/lib/batches/batchKennzeichnungDisplay";
import type { BatchRechnungDetail, BatchRechnungRow } from "@/lib/batches/batchTypes";
import { parseDetailJson } from "@/lib/batches/batchTypes";
import type { Rechnungsentwurf, RechnungsHinweis, RechnungsPosition } from "./rechnungsentwurfTypes";

function regelwerkFromDetail(d: BatchRechnungDetail): Regelwerk {
  const gopVorkommen = d.positionen.some(
    (p) => p.ziffer && /^\d{5}$/.test((p.ziffer || "").replace(/\D/g, "").slice(0, 5)),
  );
  if (gopVorkommen || d.metadata?.quelle === "pad") return "EBM";
  return "GOAE";
}

function positionenToSpec(d: BatchRechnungDetail, regelwerk: Regelwerk): RechnungsPosition[] {
  return d.positionen.map((p) => {
    const anzahl = 1;
    const ges = typeof p.betrag === "number" ? p.betrag : 0;
    const einzel = anzahl > 0 ? Math.round((ges / anzahl) * 100) / 100 : 0;
    const k = p.kennzeichnung ?? kennFromLegacyPill(p.pill);
    const pos: RechnungsPosition = {
      ziffer: p.ziffer ?? String(p.nr),
      beschreibung: (p.titel || p.text || p.hinweis || "—").trim() || "—",
      anzahl,
      einzelbetrag: einzel,
      gesamtbetrag: ges,
      isAnalog: false,
      kennzeichnung: k,
    };
    if (regelwerk === "GOAE" && p.faktor != null) pos.faktor = p.faktor;
    if (p.text || p.titel) {
      const parts = [p.hinweis, p.text].filter(Boolean);
      if (parts.length) pos.begruendung = parts.join(" — ");
    }
    return pos;
  });
}

function hinweiseFromDetail(d: BatchRechnungDetail): RechnungsHinweis[] {
  const out: RechnungsHinweis[] = [];
  d.positionen.forEach((p, i) => {
    const k = p.kennzeichnung ?? kennFromLegacyPill(p.pill);
    const t = (p.hinweis || "").trim();
    if (!t) return;
    const typ: RechnungsHinweis["typ"] =
      k === "FEHLER" || k === "RISIKO" ? "warnung" : k === "UNVOLLSTÄNDIG" ? "pflicht" : "info";
    out.push({ positionIndex: i, typ, text: t });
  });
  return out;
}

/**
 * Baut einen Spec-04-`Rechnungsentwurf` aus einer Batch-Zeile (Status „fertig“ nach Nutzerbestätigung / Export-Start).
 */
export function rechnungsentwurfFromBatchRechnungRow(
  row: BatchRechnungRow,
  opts?: { status?: "fertig" | "exportiert"; erstelltAm?: string },
): Rechnungsentwurf {
  const d = row.detail;
  const regelwerk = regelwerkFromDetail(d);
  const positionen = positionenToSpec(d, regelwerk);
  const ges = typeof d.gesamt === "number" && Number.isFinite(d.gesamt) ? d.gesamt : row.betragEuro;
  const status = opts?.status ?? "fertig";
  const erstelltAm = opts?.erstelltAm ?? new Date().toISOString();
  return {
    id: row.id,
    batchId: row.batchId,
    patient: { pseudonymId: row.patientIdLabel },
    regelwerk,
    positionen,
    gesamtbetrag: Math.round(ges * 100) / 100,
    status: status as Rechnungsentwurf["status"],
    erstelltAm,
    hinweise: hinweiseFromDetail(d),
    einwilligungsHinweise: [],
  };
}

/**
 * Wie `rechnungsentwurfFromBatchRechnungRow`, liest `detail` aus geparstem JSON.
 */
export function rechnungsentwurfFromDetailJson(
  id: string,
  batchId: string,
  patientIdLabel: string,
  betragEuro: number,
  detailJson: Parameters<typeof parseDetailJson>[0],
  opts?: { status?: "fertig" | "exportiert"; erstelltAm?: string },
): Rechnungsentwurf {
  const detail = parseDetailJson(detailJson);
  const row: BatchRechnungRow = {
    id,
    batchId,
    fallId: "00000000-0000-4000-8000-000000000001",
    sortOrder: 0,
    patientIdLabel,
    betragEuro,
    listeStatus: "geprueft",
    hinweiseKurz: null,
    fachbereich: null,
    detail,
    vorschlaegeAngenommen: false,
    aenderungenAnzahl: 0,
    optimierungAngewendetEuro: 0,
  };
  return rechnungsentwurfFromBatchRechnungRow(row, opts);
}
