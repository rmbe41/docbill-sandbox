import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let workerReady: Promise<void> | null = null;
function ensureWorker(): Promise<void> {
  if (!workerReady) {
    const g = globalThis as typeof globalThis & { pdfjsWorker?: { WorkerMessageHandler?: unknown } };
    workerReady =
      g.pdfjsWorker?.WorkerMessageHandler != null
        ? Promise.resolve()
        : import(/* @vite-ignore */ pdfjsWorker).then(() => {});
  }
  return workerReady;
}

/** Volltext aus PDF-Bytes (z. B. nach Download aus Storage). */
export async function extractTextFromPdfArrayBuffer(arrayBuffer: ArrayBuffer): Promise<string> {
  await ensureWorker();
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const texts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item && typeof (item as { str?: string }).str === "string" ? (item as { str: string }).str : ""))
      .join(" ");
    texts.push(pageText);
  }
  return texts.join("\n\n");
}

/** Volltext aus PDF (Spec 02 — Parsing) für Stapel-Import. */
export async function extractTextFromPdfFile(file: File): Promise<string> {
  return extractTextFromPdfArrayBuffer(await file.arrayBuffer());
}
