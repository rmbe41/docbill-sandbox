/**
 * Heuristik: mehrere Rechnungen/Patienten in einer PAD-Datei (Spec 03 §5.1).
 * Ohne vollständigen PAD-Parser: Blöcke / Datensätze grob zählen.
 */
export async function estimatePadRechnungCount(file: File): Promise<number> {
  const text = await file.text();
  const normalized = text.replace(/\r\n/g, "\n");
  const blocks = normalized.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 40);
  if (blocks.length >= 2) return blocks.length;
  const patientish = normalized.match(/(?:^|\n)\s*(?:P-\d+|Pat\.|Patient(?:in)?)\b/gim);
  if (patientish && patientish.length >= 1) return Math.max(1, patientish.length);
  const rechnungHeaders = normalized.match(/(?:^|\n)\s*RECHNUNG\b/gi);
  if (rechnungHeaders && rechnungHeaders.length >= 2) return rechnungHeaders.length;
  return 1;
}
