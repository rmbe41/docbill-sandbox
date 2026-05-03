import type { ConfidenceLevel, SandboxInvoice, ServiceItemEbm, ServiceItemGoae } from "./types";

/** Summe nur der zur Rechnungsgrundlage gehörenden Positionen — EBM vs. GOÄ nicht addieren */
export function recalcInvoiceTotal(inv: SandboxInvoice): number {
  const basis =
    inv.billing_basis ??
    (inv.service_items_ebm.length > 0 && inv.service_items_goae.length === 0 ? "statutory" : "private");
  if (basis === "statutory") {
    const eb = inv.service_items_ebm.reduce((s, x) => s + (x.amount_eur ?? 0), 0);
    return Math.round(eb * 100) / 100;
  }
  const go = inv.service_items_goae.reduce((s, x) => s + x.amount, 0);
  return Math.round(go * 100) / 100;
}

function confidenceFromBillingDifficulty(diff: SandboxInvoice["billing_difficulty"]): {
  confidence_tier: ConfidenceLevel;
  confidence_percent: number;
} {
  if (diff === "hard") return { confidence_tier: "low", confidence_percent: 38 };
  if (diff === "medium") return { confidence_tier: "medium", confidence_percent: 64 };
  return { confidence_tier: "high", confidence_percent: 89 };
}

function cardSummaryGerman(ebm: ServiceItemEbm[], goae: ServiceItemGoae[]): string {
  const ePart = ebm
    .slice(0, 4)
    .map((x) => x.code)
    .join(", ");
  const gPart = goae
    .slice(0, 4)
    .map((x) => x.code)
    .join(", ");
  const eMore = ebm.length > 4 ? " …" : "";
  const gMore = goae.length > 4 ? " …" : "";
  if (ePart && gPart) return `EBM ${ePart}${eMore} · GOÄ ${gPart}${gMore}`;
  if (ePart) return `EBM ${ePart}${eMore}`;
  return `GOÄ ${gPart}${gMore}`;
}

export function invoicePresentationPatch(
  inv: SandboxInvoice,
): Pick<SandboxInvoice, "confidence_tier" | "confidence_percent" | "card_code_summary" | "total_amount"> {
  const diff = inv.billing_difficulty ?? "medium";
  const conf = confidenceFromBillingDifficulty(diff);
  return {
    total_amount: recalcInvoiceTotal(inv),
    ...conf,
    card_code_summary: cardSummaryGerman(inv.service_items_ebm, inv.service_items_goae),
  };
}
