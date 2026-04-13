import { goaeByZiffer, type GoaeZiffer } from "@/data/goae-catalog";

const PUNKTWERT = 0.0582873;

export type ParsedPosition = {
  ziffer: string;
  faktor: number;
  betrag?: number;
};

export type ValidationResult = {
  type: "exclusion" | "amount" | "threshold";
  severity: "error" | "warning";
  message: string;
};

/**
 * Validates a set of GOÄ positions for exclusion conflicts,
 * correct amounts, and threshold warnings.
 */
export function validatePositions(positions: ParsedPosition[]): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const ziffer = goaeByZiffer.get(pos.ziffer);
    if (!ziffer) continue;

    // Check exclusion conflicts with all other positions
    for (let j = i + 1; j < positions.length; j++) {
      const other = positions[j];
      if (ziffer.ausschlussziffern.includes(other.ziffer)) {
        const otherZiffer = goaeByZiffer.get(other.ziffer);
        results.push({
          type: "exclusion",
          severity: "error",
          message: `GOÄ ${pos.ziffer} (${ziffer.bezeichnung}) ist neben GOÄ ${other.ziffer}${otherZiffer ? ` (${otherZiffer.bezeichnung})` : ""} nicht berechnungsfähig.`,
        });
      }
    }

    // Validate amount if provided
    if (pos.betrag !== undefined) {
      const expected = round2(ziffer.punkte * PUNKTWERT * pos.faktor);
      if (Math.abs(pos.betrag - expected) > 0.02) {
        results.push({
          type: "amount",
          severity: "error",
          message: `GOÄ ${pos.ziffer}: Betrag ${formatEuro(pos.betrag)} stimmt nicht. Bei Faktor ${pos.faktor}× ergibt sich ${formatEuro(expected)} (${ziffer.punkte} Pkt × ${PUNKTWERT}€ × ${pos.faktor}).`,
        });
      }
    }

    // Check threshold warnings
    if (pos.faktor > ziffer.schwellenfaktor) {
      results.push({
        type: "threshold",
        severity: "warning",
        message: `GOÄ ${pos.ziffer}: Faktor ${pos.faktor}× überschreitet den Schwellenwert von ${ziffer.schwellenfaktor}×. Schriftliche Begründung gemäß § 12 Abs. 3 GOÄ erforderlich.`,
      });
    }

    // Check max factor
    if (pos.faktor > ziffer.hoechstfaktor) {
      results.push({
        type: "threshold",
        severity: "error",
        message: `GOÄ ${pos.ziffer}: Faktor ${pos.faktor}× überschreitet den Höchstsatz von ${ziffer.hoechstfaktor}×. Dieser Faktor ist ohne § 2-Vereinbarung nicht zulässig.`,
      });
    }
  }

  return results;
}

/**
 * Calculates the correct amount for a GOÄ position.
 */
export function calculateAmount(ziffer: string, faktor: number): number | null {
  const z = goaeByZiffer.get(ziffer);
  if (!z) return null;
  return round2(z.punkte * PUNKTWERT * faktor);
}

/** Mindest- und Höchstfaktor nach Katalog (ohne Ziffer: 1,0–3,5). */
export function goaeFaktorLimits(ziffer: string): { min: number; max: number } {
  const z = goaeByZiffer.get(ziffer);
  if (!z) return { min: 1, max: 3.5 };
  return { min: 1, max: z.hoechstfaktor };
}

/**
 * Betrag aus Katalog (Punkte × Punktwert × Faktor), sonst proportional zum Ausgangswert.
 */
export function calculateAmountOrScaled(
  ziffer: string,
  faktor: number,
  base: { betrag: number; faktor: number },
): number {
  const calc = calculateAmount(ziffer, faktor);
  if (calc != null) return calc;
  if (base.faktor <= 0) return round2(base.betrag);
  return round2((base.betrag / base.faktor) * faktor);
}

/**
 * Tries to parse GOÄ positions from the AI response text.
 * Looks for table rows with GOÄ numbers, factors, and amounts.
 */
export function parsePositionsFromText(text: string): ParsedPosition[] {
  const positions: ParsedPosition[] = [];
  // Match table rows: | ... | 1240 | ... | 2,3× | 9,92€ | ...
  const rowRegex = /\|\s*\d+\s*\|\s*(\d{1,4}[a-z]?)\s*\|[^|]*\|\s*(\d+[.,]\d+)\s*×?\s*\|[^|]*?(\d+[.,]\d+)\s*€/gi;
  let match;
  while ((match = rowRegex.exec(text)) !== null) {
    const ziffer = match[1];
    const faktor = parseFloat(match[2].replace(",", "."));
    const betrag = parseFloat(match[3].replace(",", "."));
    if (ziffer && !isNaN(faktor)) {
      positions.push({ ziffer, faktor, betrag: isNaN(betrag) ? undefined : betrag });
    }
  }
  return positions;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatEuro(n: number): string {
  return n.toFixed(2).replace(".", ",") + " €";
}
