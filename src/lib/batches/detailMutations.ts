import { kennFromLegacyPill } from "@/lib/batches/batchKennzeichnungDisplay";
import { formatHinweiseSpalte, formatStatusSpalte } from "@/lib/batches/batchKpiColumns";
import { buildKpiFromDetail, recomputeDetailKpi } from "@/lib/batches/batchKpiBuild";
import type { BatchListeStatus, BatchRechnungDetail } from "@/lib/batches/batchTypes";

export type BatchPosition = BatchRechnungDetail["positionen"][number];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function settlePruefenAccepted(p: BatchPosition): BatchPosition {
  return {
    ...p,
    pill: "Sicher",
    kennzeichnung: "SICHER",
    titel: undefined,
    hinweis: undefined,
    text: p.text?.trim() || "Prüfhinweis übernommen.",
  };
}

function settlePruefenRejected(p: BatchPosition): BatchPosition {
  return {
    ...p,
    pill: "Sicher",
    kennzeichnung: "SICHER",
    titel: undefined,
    hinweis: undefined,
    text: "Vorschlag nicht übernommen.",
  };
}

function settlePruefenAdjusted(p: BatchPosition, userText: string): BatchPosition {
  const t = userText.trim();
  return {
    ...p,
    pill: "Sicher",
    kennzeichnung: "SICHER",
    titel: undefined,
    hinweis: undefined,
    text: t || p.text?.trim() || "Angepasste Dokumentation / Begründung.",
  };
}

function settlePflichtAdded(p: BatchPosition): BatchPosition {
  const bet = p.betrag ?? 0;
  const euro = bet.toFixed(2).replace(".", ",");
  return {
    ...p,
    fehlend: false,
    pill: "Sicher",
    kennzeichnung: "SICHER",
    titel: undefined,
    hinweis: undefined,
    text: p.ziffer
      ? `GOP ${p.ziffer} zur Abrechnung ergänzt (${euro} €).`
      : `Position ergänzt (${euro} €).`,
  };
}

function settlePflichtIgnored(p: BatchPosition): BatchPosition {
  return {
    ...p,
    fehlend: false,
    pill: "Sicher",
    kennzeichnung: "SICHER",
    titel: undefined,
    hinweis: undefined,
    text: "Kombinations-/Ergänzungspflicht bewusst nicht umgesetzt.",
  };
}

function isOffenePosition(p: BatchPosition): boolean {
  const k = p.kennzeichnung ?? kennFromLegacyPill(p.pill);
  return k !== "SICHER";
}

export function isPruefbar(p: BatchPosition): boolean {
  const k = p.kennzeichnung ?? kennFromLegacyPill(p.pill);
  return k === "PRÜFEN" || k === "OPTIMIERUNG" || k === "RISIKO" || k === "FEHLER";
}

export function isPflicht(p: BatchPosition): boolean {
  const k = p.kennzeichnung ?? kennFromLegacyPill(p.pill);
  return k === "UNVOLLSTÄNDIG" || p.pill === "Pflicht fehlt";
}

/** Liste-Status aus verbleibenden offenen Positionen ableiten (Spec 03). */
export function deriveListeStatus(detail: BatchRechnungDetail): BatchListeStatus {
  const kpi = buildKpiFromDetail(detail);
  if (kpi.fehler > 0) return "fehler";
  if (kpi.hinweisGesamt > 0) return "mit_hinweisen";
  return "geprueft";
}

export function deriveHinweiseKurzForDetail(detail: BatchRechnungDetail): string | null {
  const st = deriveListeStatus(detail);
  const h = formatHinweiseSpalte(detail.kpi ?? buildKpiFromDetail(detail), st);
  return h === "—" ? null : h;
}

export function deriveStatusSpalteForDetail(detail: BatchRechnungDetail, liste: BatchListeStatus): string {
  return formatStatusSpalte(liste, detail.kpi ?? buildKpiFromDetail(detail));
}

function clearDeltaIfNoPflicht(detail: BatchRechnungDetail): BatchRechnungDetail {
  const stillPflicht = detail.positionen.some(
    (p) => p.fehlend && isPflicht(p),
  );
  if (stillPflicht) return recomputeDetailKpi(detail);
  return recomputeDetailKpi({
    ...detail,
    gesamtNach: undefined,
    deltaLabel: undefined,
  });
}

export function acceptPruefenPosition(detail: BatchRechnungDetail, nr: number): BatchRechnungDetail {
  const next = detail.positionen.map((p) => (p.nr === nr && isPruefbar(p) ? settlePruefenAccepted(p) : p));
  return clearDeltaIfNoPflicht({ ...detail, positionen: next });
}

export function rejectPruefenPosition(detail: BatchRechnungDetail, nr: number): BatchRechnungDetail {
  const next = detail.positionen.map((p) => (p.nr === nr && isPruefbar(p) ? settlePruefenRejected(p) : p));
  return clearDeltaIfNoPflicht({ ...detail, positionen: next });
}

export function adjustPruefenPosition(detail: BatchRechnungDetail, nr: number, userText: string): BatchRechnungDetail {
  const next = detail.positionen.map((p) =>
    p.nr === nr && isPruefbar(p) ? settlePruefenAdjusted(p, userText) : p,
  );
  return clearDeltaIfNoPflicht({ ...detail, positionen: next });
}

export function addPflichtPosition(detail: BatchRechnungDetail, nr: number): BatchRechnungDetail {
  const pos = detail.positionen.find((p) => p.nr === nr && isPflicht(p) && p.fehlend);
  if (!pos) return detail;
  const add = pos.betrag ?? 0;
  const next = detail.positionen.map((p) => (p.nr === nr && isPflicht(p) ? settlePflichtAdded(p) : p));
  return recomputeDetailKpi({
    ...detail,
    positionen: next,
    gesamt: round2(detail.gesamt + add),
    gesamtNach: undefined,
    deltaLabel: undefined,
  });
}

export function ignorePflichtPosition(detail: BatchRechnungDetail, nr: number): BatchRechnungDetail {
  const next = detail.positionen.map((p) => (p.nr === nr && isPflicht(p) ? settlePflichtIgnored(p) : p));
  return clearDeltaIfNoPflicht({ ...detail, positionen: next });
}

/** Alle offenen „Prüfen“ ablehnen und alle „Pflicht fehlt“ ignorieren (Taste r / Sammelablehnung). */
export function rejectAllOpenSuggestions(detail: BatchRechnungDetail): BatchRechnungDetail {
  let d: BatchRechnungDetail = { ...detail, positionen: [...detail.positionen] };
  const toReject = d.positionen.filter((p) => isPruefbar(p)).map((p) => p.nr);
  const toIgnore = d.positionen.filter((p) => isPflicht(p) && p.fehlend).map((p) => p.nr);
  for (const nr of toReject) d = rejectPruefenPosition(d, nr);
  for (const nr of toIgnore) d = ignorePflichtPosition(d, nr);
  return d;
}

export function countOpenSuggestions(detail: BatchRechnungDetail): number {
  return detail.positionen.filter(isOffenePosition).length;
}
