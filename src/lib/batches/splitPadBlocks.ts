/**
 * Teilt PAD-Text grob in Rechnungseinheiten (Spec 02/03, heuristisch).
 * Nutzt dieselbe Idee wie padInvoiceEstimate.
 */
export function splitPadToBlocks(fileText: string): string[] {
  const normalized = fileText.replace(/\r\n/g, "\n");
  const blocks = normalized
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 40);
  if (blocks.length >= 2) return blocks;
  const patientish = normalized.match(/(?:^|\n)\s*(?:P-\d+|Pat\.|Patient(?:in)?)\b/gim);
  if (patientish && patientish.length >= 2) {
    return normalized
      .split(/(?=^\s*P-\d+|\bPat\.|Patient(?:in)?\b)/m)
      .map((b) => b.trim())
      .filter((b) => b.length > 20);
  }
  return [normalized.trim() || " "];
}
