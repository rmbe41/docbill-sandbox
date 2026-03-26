import { goaeByZiffer } from "@/data/goae-catalog";

/** Entfernt führendes „Begründung:“ damit die UI nicht doppelt labelt. */
export function stripDuplicateBegruendungPrefix(text: string): string {
  return text
    .trim()
    .replace(/^begründung\s*:\s*/i, "")
    .replace(/^begründung\s+/i, "")
    .trim();
}

export function isFaktorUeberSchwelle(ziffer: string, faktor: number): boolean {
  const z = goaeByZiffer.get(ziffer);
  const schw = z?.schwellenfaktor ?? 2.3;
  return faktor > schw + 1e-9;
}

/**
 * Zeileninhalt für PDF-Spalte Begründung: bei Steigerung oberhalb Schwelle festes Label.
 */
export function formatBegruendungFuerPdf(
  ziffer: string,
  faktor: number,
  begruendung: string | undefined,
): string | undefined {
  const raw = begruendung?.trim();
  if (!raw) return undefined;
  if (!isFaktorUeberSchwelle(ziffer, faktor)) return raw;
  const body = stripDuplicateBegruendungPrefix(raw);
  return `Begründung: ${body}`;
}
