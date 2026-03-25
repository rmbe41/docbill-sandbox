// GOÄ-Katalog: kanonisch goae-catalog-full.json (siehe goae-catalog-json.ts).
// Legacy-Kompakttext entfällt; Prompts nutzen selektive Markdown-Auszüge.

import type { ParsedRechnung } from "./pipeline/types.ts";
import {
  expandZiffernMitAusschlüssen,
  formatCatalogEntryLine,
  goaeByZiffer,
  GOAE_KATALOG_HEADER,
} from "./goae-catalog-json.ts";

/** @deprecated Nur noch Kompatibilität; Regelengine nutzt JSON direkt. */
export const GOAE_KATALOG = "";

/**
 * Reduzierter Katalog für Simple-Pipeline: Positionen + Ausschlüsse + Grundleistungen 1–8.
 */
export function buildRelevantCatalog(parsed: ParsedRechnung): string {
  const want = new Set<string>(["1", "2", "3", "4", "5", "6", "7", "8"]);
  for (const p of parsed.positionen) {
    if (p.ziffer) want.add(String(p.ziffer).trim());
  }

  const expanded = expandZiffernMitAusschlüssen(want);

  const headerLines = [GOAE_KATALOG_HEADER, "", "## Relevante Ziffern für diese Rechnung", ""];
  const dataLines: string[] = [];

  const sorted = [...expanded].filter((z) => goaeByZiffer.has(z)).sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    const ia = Number.isNaN(na) ? 99999 : na;
    const ib = Number.isNaN(nb) ? 99999 : nb;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });

  for (const z of sorted) {
    const e = goaeByZiffer.get(z);
    if (e) dataLines.push(formatCatalogEntryLine(e));
  }

  return [
    ...headerLines,
    ...dataLines,
    "",
    "## Wichtige GOÄ-Abrechnungsregeln",
    "1. Ausschlussziffern beachten",
    "2. Steigerungsbegründung über Schwellenwert erforderlich",
    "3. Zielleistungsprinzip: Teilschritte nicht separat",
    "4. Analogbewertung: analoge Ziffer mit Begründung",
  ].join("\n");
}
