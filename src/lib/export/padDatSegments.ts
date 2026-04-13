/**
 * Segmentierung einer PAD/DAT-Textdatei in logische Belege.
 * Primär: jeder Block ab einer Zeile mit `PAD-DATEN` bis vor die nächste solche Zeile.
 * Fehlt der Kopf, wird die gesamte (nicht-leere) Datei als ein Segment behandelt.
 */
export function splitPadDatIntoSegments(raw: string): string[][] {
  const lines = raw.split(/\r?\n/);
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("PAD-DATEN")) starts.push(i);
  }
  if (!starts.length) {
    const nonEmpty = lines.filter((l, idx) => l.trim().length > 0 || idx < lines.length - 1);
    const trimmed = nonEmpty.length && !nonEmpty[nonEmpty.length - 1]?.trim()
      ? nonEmpty.slice(0, -1)
      : nonEmpty;
    return trimmed.some((l) => l.trim()) ? [trimmed] : [];
  }
  const out: string[][] = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s]!;
    const to = s + 1 < starts.length ? starts[s + 1]! : lines.length;
    const chunk = lines.slice(from, to);
    if (chunk.some((l) => l.trim())) out.push(chunk);
  }
  return out;
}

export function joinPadDatSegments(segments: string[][]): string {
  return segments.map((s) => s.join("\n")).join("\n\n");
}
