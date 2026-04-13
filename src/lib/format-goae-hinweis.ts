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

/**
 * Übernehmbare Formulierung für die Patientenakte, wenn der Faktor über dem Regelhöchstsatz liegt.
 *
 * Bewusst ohne eingefügte Katalog-Wortlaute oder Quellen-Spalten: Abgeschnittene GOÄ-Texte ergeben
 * ungrammatikalische Sätze; frei erfasste Quellen sind oft OCR-/Tippfehler und nicht verlässlich.
 * Konkrete medizinische Umstände muss die behandelnde Person in der Akte ergänzen.
 */
export function buildSteigerungsbegruendungVorschlag(params: {
  ziffer: string;
  faktor: number;
  betragFormatted: string;
}): string {
  const z = goaeByZiffer.get(params.ziffer);
  const schw = z?.schwellenfaktor ?? 2.3;
  const f = String(params.faktor).replace(".", ",");
  const schwStr = String(schw).replace(".", ",");
  const kopf = `GOÄ ${params.ziffer} · Faktor ${f} (Betrag ${params.betragFormatted}) · über Regelhöchstsatz ${schwStr}`;
  return (
    `${kopf}. ` +
    `Steigerung gemäß GOÄ (schriftliche Begründung der Gebühren): ` +
    `erhöhter zeitlicher und technischer Aufwand sowie besondere Schwierigkeit bei der Durchführung der Leistung nach GOÄ-Ziffer ${params.ziffer}; ` +
    `die im Einzelfall maßgeblichen Umstände sind in der Patientenakte dokumentiert.`
  );
}

export function buildHoechstfaktorHinweisText(ziffer: string, faktor: number): string {
  const z = goaeByZiffer.get(ziffer);
  const h = z?.hoechstfaktor ?? 3.5;
  const f = String(faktor).replace(".", ",");
  const hStr = String(h).replace(".", ",");
  return (
    `Der gewählte Faktor (${f}) liegt über dem GOÄ-Höchstfaktor (${hStr}) für Ziffer ${ziffer}. ` +
    `Eine Abrechnung oberhalb des Höchstsatzes setzt eine gesonderte Honorarvereinbarung mit dem Patienten bzw. der Patientin voraus.`
  );
}
