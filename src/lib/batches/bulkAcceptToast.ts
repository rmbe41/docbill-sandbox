import type { BulkResult } from "@/lib/batches/applyBulk";

/** Spec 03 §5.1 — Zusammenfassungstext nach Bulk „Alle Vorschläge annehmen“ */
export function formatBulkAcceptToastDescription(r: Pick<BulkResult, "aenderungenGesamt" | "rechnungCount" | "betragDeltaSumme">): string {
  const a = r.aenderungenGesamt;
  const n = r.rechnungCount;
  const aendWord = a === 1 ? "Änderung" : "Änderungen";
  const rWord = n === 1 ? "Rechnung" : "Rechnungen";
  const first = `${a} ${aendWord} an ${n} ${rWord} übernommen.`;
  if (r.betragDeltaSumme > 0) {
    const eur = r.betragDeltaSumme.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
    return `${first} Gesamtbetrag: +${eur.replace(/^\s*/, "")}`;
  }
  return `${first} (Kein numerisches Betrags-Δ in der Vorschau.)`;
}
