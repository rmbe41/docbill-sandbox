import type { HighlightSnippet, SandboxInvoice } from "./types";

/** System/Personen wie in den Dokumentblöcken der Review-Ansicht */
export function germanLabelForSandboxDocField(field: HighlightSnippet["field"]): string {
  switch (field) {
    case "anamnesis":
      return "Anamnese";
    case "findings":
      return "Befund";
    case "diagnosis_text":
      return "Diagnose";
    case "therapy":
      return "Therapie";
    default:
      return field;
  }
}

export type BillingLineEvidenceKind = "ebm" | "goae";

/** Alle Demo-Highlights, die diese Ziffer (= `ref`) begründen. */
export function sandboxHighlightsForCode(
  highlights: readonly HighlightSnippet[] | undefined,
  code: string,
): HighlightSnippet[] {
  return (highlights ?? []).filter((x) => x.ref === code);
}

/** Eine Positionszeile der Rechnung mit Zuordnungen zur Akte über `HighlightSnippet` (gleiche `ref` wie Code). */
export type BillingLineEvidence = {
  key: string;
  kind: BillingLineEvidenceKind;
  code: string;
  label: string;
  links: HighlightSnippet[];
};

export function sandboxInvoiceLineEvidenceRows(
  invoice: SandboxInvoice,
  highlights: readonly HighlightSnippet[] | undefined,
): BillingLineEvidence[] {
  const h = highlights ?? [];
  const rows: BillingLineEvidence[] = [];

  if (invoice.billing_basis === "statutory") {
    invoice.service_items_ebm.forEach((row, i) => {
      const links = sandboxHighlightsForCode(h, row.code);
      rows.push({
        key: `ebm-${i}-${row.code}`,
        kind: "ebm",
        code: row.code,
        label: row.label,
        links,
      });
    });
  } else {
    invoice.service_items_goae.forEach((row, i) => {
      const links = sandboxHighlightsForCode(h, row.code);
      rows.push({
        key: `goae-${i}-${row.code}`,
        kind: "goae",
        code: row.code,
        label: row.label,
        links,
      });
    });
  }

  return rows;
}
