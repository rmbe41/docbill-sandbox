/**
 * PAD P0: Format-Erkennung und minimale Positionsliste (Spec 02 §4.1).
 */

export type PadFormatId = "PAD_STANDARD" | "TURBOMED" | "CGM_M1";

export type PadParsedPosition = {
  ziffer: string;
  anzahl: number;
  einzelbetrag: number;
  gesamtbetrag: number;
  datum?: string;
};

export type PadParseResult = {
  format: PadFormatId;
  rawText: string;
  positionen: PadParsedPosition[];
};

const UNKNOWN_PAD_MESSAGE =
  "Dieses PAD-Format wird noch nicht unterstützt. Bitte exportieren Sie die Daten als PDF oder CSV.";

export { UNKNOWN_PAD_MESSAGE };

function decodeToText(buf: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  } catch {
    return "";
  }
}

/** Heuristik: erste treffende Signatur gewinnt. */
export function detectPadFormat(content: Uint8Array | string): PadFormatId | null {
  const text = typeof content === "string" ? content : decodeToText(content);
  const head = text.slice(0, 8000).toUpperCase();
  const full = text.toUpperCase();

  if (/\bTURBOMED\b/.test(full) || /\bTM_PAT\b/.test(head)) return "TURBOMED";
  if (/\bCGM\b/.test(head) && /\bM1\b/.test(head.slice(0, 2000))) return "CGM_M1";
  if (
    /\bBEGIN\b[\s\S]{0,400}\bABRECHNUNG\b/i.test(text.slice(0, 4000)) ||
    /^\s*\d{5}\s*[;|\t]/m.test(text) ||
    /\bGOP\b.*\bPUNKTE\b/i.test(text.slice(0, 4000))
  ) {
    return "PAD_STANDARD";
  }
  return null;
}

/** Einfache GOP-Zeilen: `01400;1;12.50` oder `01400\t1\t12,50` */
function parseGopLines(text: string): PadParsedPosition[] {
  const lines = text.split(/\r?\n/);
  const out: PadParsedPosition[] = [];
  const re = /^\s*(\d{5})\s*[,;|\t]\s*(\d+)\s*[,;|\t]\s*([\d.,]+)/;
  for (const line of lines) {
    const m = re.exec(line.trim());
    if (!m) continue;
    const gop = m[1];
    const anzahl = Math.max(1, parseInt(m[2], 10) || 1);
    const euro = parseFloat(m[3].replace(",", ".")) || 0;
    const gesamt = euro * anzahl;
    out.push({
      ziffer: gop,
      anzahl,
      einzelbetrag: euro,
      gesamtbetrag: Math.round(gesamt * 100) / 100,
    });
  }
  return out;
}

export function parsePadFile(content: Uint8Array | string, hint?: PadFormatId | null): PadParseResult {
  const buf = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const text = typeof content === "string" ? content : decodeToText(buf);
  const fmt = hint ?? detectPadFormat(buf);

  if (!fmt) {
    throw new Error(UNKNOWN_PAD_MESSAGE);
  }

  let positionen = parseGopLines(text);
  if (positionen.length === 0) {
    const reLoose = /\b(\d{5})\b[^\d\n]{0,24}?(\d+)\s*[^\d\n]{0,8}?([\d.,]+)\s*€?/gim;
    let mm: RegExpExecArray | null;
    while ((mm = reLoose.exec(text)) !== null) {
      const anzahl = Math.max(1, parseInt(mm[2], 10) || 1);
      const euro = parseFloat(mm[3].replace(",", ".")) || 0;
      positionen.push({
        ziffer: mm[1],
        anzahl,
        einzelbetrag: euro,
        gesamtbetrag: Math.round(euro * anzahl * 100) / 100,
      });
    }
  }

  return {
    format: fmt,
    rawText: text.slice(0, 500_000),
    positionen,
  };
}
