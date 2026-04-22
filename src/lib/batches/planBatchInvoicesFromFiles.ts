import { extractTextFromPdfFile } from "@/lib/batches/extractPdfTextForBatch";
import { splitPadToBlocks } from "@/lib/batches/splitPadBlocks";

export type GeplanteRechnungEingabe = {
  rohText: string;
  fileName: string;
  quelle: "pdf" | "pad" | "bild";
  sortOrder: number;
  /** Index in der ursprünglichen `File[]`-Liste (für Storage-Pfad). */
  sourceFileIndex: number;
};

/** PDF, PAD oder Bild (JPEG/PNG/WebP/GIF u. a.; MIME image/*). */
export function isBatchPlanInputFile(f: File): boolean {
  const n = f.name.toLowerCase();
  if (n.endsWith(".pdf") || f.type === "application/pdf") return true;
  if (n.endsWith(".pad")) return true;
  if (
    n.endsWith(".jpg") ||
    n.endsWith(".jpeg") ||
    n.endsWith(".png") ||
    n.endsWith(".webp") ||
    n.endsWith(".gif")
  )
    return true;
  if (f.type.startsWith("image/")) return true;
  return false;
}

const PAT = /P-\d{3,4}|Pat(?:ient)?-?ID[:\s#]*([A-Z0-9-]+)/i;

function patLabelFromText(t: string, fallIndex: number): string {
  const m = t.match(PAT);
  if (m) {
    if (m[0].startsWith("P-")) return m[0].replace(/\s/g, "");
    if (m[1]) return m[1].length < 2 ? `P-${String(fallIndex + 1).padStart(4, "0")}` : m[1];
  }
  return `P-${String(fallIndex + 1).padStart(4, "0")}`;
}

/**
 * Liefert eine flache Liste geplanter Eingabetexte pro Rechnung (Spec 02/03).
 * PDF: eine Rechnung pro Datei; PAD: geteilte Blöcke.
 */
export async function planBatchInvoicesFromFiles(
  files: File[],
  startSort = 0,
): Promise<GeplanteRechnungEingabe[]> {
  const out: GeplanteRechnungEingabe[] = [];
  let sort = startSort;
  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi];
    const name = f.name.toLowerCase();
    if (name.endsWith(".pdf") || f.type === "application/pdf") {
      const roh = await extractTextFromPdfFile(f);
      out.push({ rohText: roh, fileName: f.name, quelle: "pdf", sortOrder: sort++, sourceFileIndex: fi });
    } else if (name.endsWith(".pad")) {
      const text = await f.text();
      const blocks = splitPadToBlocks(text);
      for (const b of blocks) {
        out.push({ rohText: b, fileName: f.name, quelle: "pad", sortOrder: sort++, sourceFileIndex: fi });
      }
    } else if (isBatchPlanInputFile(f)) {
      out.push({ rohText: "", fileName: f.name, quelle: "bild", sortOrder: sort++, sourceFileIndex: fi });
    }
  }
  return out;
}

export function betragGrobAusText(t: string): number {
  const m = t.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/g);
  let best = 0;
  for (const x of m) {
    const v = parseFloat(x[1]!.replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(v)) best = Math.max(best, v);
  }
  return round2(Math.max(best, 50 + (t.length % 200)));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export { patLabelFromText };
