import type { ConfidenceLevel, DiagnosisRow, SandboxInvoice, ServiceItemGoae } from "./types";

export function recalcInvoiceTotal(inv: SandboxInvoice): number {
  const eb = inv.service_items_ebm.reduce((s, x) => s + (x.amount_eur ?? 0), 0);
  const go = inv.service_items_goae.reduce((s, x) => s + x.amount, 0);
  return Math.round((eb + go) * 100) / 100;
}

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** Deterministischer Score pro ICD-Zeile (Prototyp), passend zur Stufe. */
function diagnosisScorePercent(row: DiagnosisRow): number {
  const frac = (hashStr(`${row.code}:${row.confidence}`) % 1000) / 1000;
  if (row.confidence === "high") return Math.round(87 + frac * 10);
  if (row.confidence === "medium") return Math.round(55 + frac * 18);
  return Math.round(24 + frac * 18);
}

export function confidencePercentFromDiagnoses(rows: DiagnosisRow[]): number {
  if (rows.length === 0) return 72;
  return Math.min(...rows.map(diagnosisScorePercent));
}

function tierFromDiagnoses(d: DiagnosisRow[]): ConfidenceLevel {
  if (d.some((x) => x.confidence === "low")) return "low";
  if (d.some((x) => x.confidence === "medium")) return "medium";
  return "high";
}

function cardSummary(d: DiagnosisRow[], g: ServiceItemGoae[]): string {
  const icd = d[0]?.code ?? "—";
  const z = g[0]?.code ?? "—";
  return `GOÄ ${z} · ICD ${icd}`;
}

export function invoicePresentationPatch(
  inv: SandboxInvoice,
): Pick<SandboxInvoice, "confidence_tier" | "confidence_percent" | "card_code_summary" | "total_amount"> {
  return {
    total_amount: recalcInvoiceTotal(inv),
    confidence_tier: tierFromDiagnoses(inv.diagnosis_codes),
    confidence_percent: confidencePercentFromDiagnoses(inv.diagnosis_codes),
    card_code_summary: cardSummary(inv.diagnosis_codes, inv.service_items_goae),
  };
}
