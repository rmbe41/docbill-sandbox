import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { recomputeDetailKpi } from "@/lib/batches/batchKpiBuild";
import type { BatchRechnungDetail } from "@/lib/batches/batchTypes";
import {
  acceptPruefenPosition,
  addPflichtPosition,
  adjustPruefenPosition,
  deriveHinweiseKurzForDetail,
  deriveListeStatus,
  ignorePflichtPosition,
  isPflicht,
  isPruefbar,
  rejectAllOpenSuggestions,
  rejectPruefenPosition,
  type BatchPosition,
} from "@/lib/batches/detailMutations";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function recalculateBatchZusammenfassung(batchId: string): Promise<void> {
  const { data: reRows, error } = await supabase
    .from("batch_rechnungen")
    .select("liste_status, betrag_euro")
    .eq("batch_id", batchId);
  if (error) {
    console.error(error);
    return;
  }
  const rlist = reRows ?? [];
  const gepr = rlist.filter((r) => (r as { liste_status: string }).liste_status === "geprueft").length;
  const hinw = rlist.filter((r) => (r as { liste_status: string }).liste_status === "mit_hinweisen").length;
  const fehl = rlist.filter((r) => (r as { liste_status: string }).liste_status === "fehler").length;
  const offen = rlist.filter((r) => (r as { liste_status: string }).liste_status === "offen").length;
  const gesamt = rlist.reduce((s, r) => s + Number((r as { betrag_euro: number }).betrag_euro), 0);
  const opt = round2(gesamt * 0.022);
  const hasProblem = fehl > 0 || offen > 0 || hinw > 0;
  const status = hasProblem ? "partial" : "complete";
  const zusammenfassung = {
    gesamtbetrag: round2(gesamt),
    geprueft: gepr,
    mitHinweisen: hinw,
    mitFehlern: fehl,
    offen,
    optimierungspotenzial: opt,
  };
  await supabase
    .from("batches")
    .update({
      zusammenfassung,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);
}

export type BatchPositionPersistAction =
  | { kind: "accept_pruefen"; nr: number }
  | { kind: "reject_pruefen"; nr: number }
  | { kind: "adjust_pruefen"; nr: number; text: string }
  | { kind: "add_pflicht"; nr: number }
  | { kind: "ignore_pflicht"; nr: number }
  | { kind: "reject_all" };

function applyAction(detail: BatchRechnungDetail, action: BatchPositionPersistAction): BatchRechnungDetail {
  const next: BatchRechnungDetail = (() => {
    switch (action.kind) {
      case "accept_pruefen":
        return acceptPruefenPosition(detail, action.nr);
      case "reject_pruefen":
        return rejectPruefenPosition(detail, action.nr);
      case "adjust_pruefen":
        return adjustPruefenPosition(detail, action.nr, action.text);
      case "add_pflicht":
        return addPflichtPosition(detail, action.nr);
      case "ignore_pflicht":
        return ignorePflichtPosition(detail, action.nr);
      case "reject_all":
        return rejectAllOpenSuggestions(detail);
    }
  })();
  return recomputeDetailKpi(next);
}

function positionMatchesAction(p: BatchPosition, action: BatchPositionPersistAction): boolean {
  if (action.kind === "reject_all") return false;
  return p.nr === action.nr;
}

/** Prüft, ob die Aktion für das aktuelle Detail noch sinnvoll ist (verhindert Doppelklicks / veraltete UI). */
export function isActionStillApplicable(detail: BatchRechnungDetail, action: BatchPositionPersistAction): boolean {
  if (action.kind === "reject_all") {
    return detail.positionen.some((p) => isPruefbar(p) || (isPflicht(p) && p.fehlend));
  }
  const p = detail.positionen.find((x) => positionMatchesAction(x, action));
  if (!p) return false;
  switch (action.kind) {
    case "accept_pruefen":
    case "reject_pruefen":
    case "adjust_pruefen":
      return isPruefbar(p);
    case "add_pflicht":
    case "ignore_pflicht":
      return isPflicht(p) && p.fehlend === true;
    default:
      return false;
  }
}

export type PersistDetailResult = { ok: true } | { ok: false; error: string };

/** Alle offenen Vorschläge ablehnen: `ok: true` enthält immer `abgelehntCount`. */
export type PersistRejectAllResult = { ok: true; abgelehntCount: number } | { ok: false; error: string };

/**
 * Lädt `detail_json`, wendet Mutation an, schreibt Liste-Status, Betrag und aktualisiert Batch-Kennzahlen.
 */
export async function persistBatchRechnungDetailMutation(
  batchId: string,
  rechnungId: string,
  action: BatchPositionPersistAction,
): Promise<PersistDetailResult> {
  const { data: row, error: fetchErr } = await supabase
    .from("batch_rechnungen")
    .select("id, detail_json")
    .eq("id", rechnungId)
    .eq("batch_id", batchId)
    .maybeSingle();
  if (fetchErr || !row) {
    console.error(fetchErr);
    return { ok: false, error: fetchErr?.message ?? "Rechnung nicht gefunden." };
  }
  const detail = row.detail_json as unknown as BatchRechnungDetail;
  if (!detail?.positionen) {
    return { ok: false, error: "Ungültiges detail_json." };
  }
  if (!isActionStillApplicable(detail, action)) {
    return { ok: false, error: "Aktion nicht mehr anwendbar (bereits erledigt)." };
  }
  const nextDetail = applyAction(detail, action);
  const listeStatus = deriveListeStatus(nextDetail);
  const hinweiseKurz = deriveHinweiseKurzForDetail(nextDetail);
  const betragEuro = round2(nextDetail.gesamt);

  const { error: upErr } = await supabase
    .from("batch_rechnungen")
    .update({
      detail_json: nextDetail as unknown as Json,
      liste_status: listeStatus,
      hinweise_kurz: hinweiseKurz,
      betrag_euro: betragEuro,
    })
    .eq("id", rechnungId);

  if (upErr) {
    console.error(upErr);
    return { ok: false, error: upErr.message };
  }

  await recalculateBatchZusammenfassung(batchId);
  return { ok: true };
}

export async function persistRejectAllForRechnung(
  batchId: string,
  rechnungId: string,
): Promise<PersistRejectAllResult> {
  const { data: row, error: fetchErr } = await supabase
    .from("batch_rechnungen")
    .select("id, detail_json")
    .eq("id", rechnungId)
    .eq("batch_id", batchId)
    .maybeSingle();
  if (fetchErr || !row) {
    console.error(fetchErr);
    return { ok: false, error: fetchErr?.message ?? "Rechnung nicht gefunden." };
  }
  const detail = row.detail_json as unknown as BatchRechnungDetail;
  if (!detail?.positionen) {
    return { ok: false, error: "Ungültiges detail_json." };
  }
  const before = detail.positionen.filter((p) => isPruefbar(p) || (isPflicht(p) && p.fehlend)).length;
  if (before === 0) {
    return { ok: false, error: "Keine offenen Vorschläge zum Ablehnen." };
  }
  const nextDetail = rejectAllOpenSuggestions(detail);
  const listeStatus = deriveListeStatus(nextDetail);
  const hinweiseKurz = deriveHinweiseKurzForDetail(nextDetail);
  const betragEuro = round2(nextDetail.gesamt);

  const { error: upErr } = await supabase
    .from("batch_rechnungen")
    .update({
      detail_json: nextDetail as unknown as Json,
      liste_status: listeStatus,
      hinweise_kurz: hinweiseKurz,
      betrag_euro: betragEuro,
    })
    .eq("id", rechnungId);

  if (upErr) {
    console.error(upErr);
    return { ok: false, error: upErr.message };
  }

  await recalculateBatchZusammenfassung(batchId);
  return { ok: true, abgelehntCount: before };
}
