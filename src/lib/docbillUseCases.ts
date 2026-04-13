/**
 * Produkt-Matrix: drei Hauptfälle + Massen-Review (siehe Plan docbill-drei-usecases-exporte).
 * Intent-Strings entsprechen der goae-chat-Pipeline / Welcome-Sticky.
 */
export type DocbillPrimaryIntent = "frage" | "leistungen_abrechnen" | "rechnung_pruefen";

export type DocbillUseCaseId = "q_and_a" | "derive_invoice" | "review_invoice" | "bulk_review";

export const DOC_BILL_USE_CASES: Record<
  DocbillUseCaseId,
  { title: string; summary: string; structuredPayload: string[] }
> = {
  q_and_a: {
    title: "Fragen und Orientierung",
    summary:
      "Schnelle GOÄ-Einordnung. Sobald konkrete Ziffern genannt werden, Export-Finalisierung (PDF, TXT, PAD/DAT) anbieten.",
    structuredPayload: ["frageAnswer", "kurzantwortenVorschlagStatus"],
  },
  derive_invoice: {
    title: "Akte oder Leistungsliste zu Rechnung",
    summary:
      "Vorschläge müssen angenommen oder abgelehnt werden (auch per Bulk). Ablehnung mit Grund und Chat-Prompt.",
    structuredPayload: ["serviceBillingResult", "suggestionDecisions.service", "serviceBegruendungText"],
  },
  review_invoice: {
    title: "Rechnung prüfen",
    summary:
      "KI-Vorschläge annehmen oder ablehnen (Bulk). Gleicher Feedback-Workflow wie bei der Leistungsliste.",
    structuredPayload: ["invoiceResult", "suggestionDecisions.invoice"],
  },
  bulk_review: {
    title: "Massen-Review",
    summary:
      "Mehrere PDFs oder eine große PAD/DAT-Datei: Warteschlange, Quelle pro Zeile, Filter, stabile reviewItemIds.",
    structuredPayload: [
      "engine3Result",
      "engine3Cases",
      "engine3SegmentationProposal",
      "suggestionDecisions.engine3",
      "engine3FaktorOverrides",
      "engine3BegruendungText",
      "BulkReviewQueue",
    ],
  },
};

export function intentToPrimaryUseCase(intent: string | null | undefined): DocbillPrimaryIntent | null {
  if (intent === "frage") return "frage";
  if (intent === "leistungen_abrechnen") return "leistungen_abrechnen";
  if (intent === "rechnung_pruefen") return "rechnung_pruefen";
  return null;
}

/** Stabile ID für Review-Zeilen (Engine 3 / PAD-Import später). */
export function engine3ReviewRowId(isOptimierung: boolean, nr: number, ziffer: string): string {
  return `${isOptimierung ? "opt" : "pos"}:${nr}:${ziffer}`;
}
