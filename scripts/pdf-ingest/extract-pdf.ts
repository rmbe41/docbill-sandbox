/**
 * PDF → Seiten-JSON mit grober Lesereihenfolge (pdfjs Text-Items nach Y/X sortiert).
 * Für layoutkritische Dokumente Stichproben im Viewer prüfen.
 */

import { readFile } from "node:fs/promises";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfPageJson } from "./types.ts";

export async function extractPdfPagesFromPath(
  filePath: string,
): Promise<PdfPageJson[]> {
  const buf = await readFile(filePath);
  return extractPdfPagesFromBuffer(buf);
}

export async function extractPdfPagesFromBuffer(buf: Buffer): Promise<PdfPageJson[]> {
  const data = new Uint8Array(buf);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pages: PdfPageJson[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const items = tc.items as {
      str: string;
      transform: number[];
      hasEOL?: boolean;
    }[];

    const withPos = items
      .filter((it) => it.str && it.str.trim().length > 0)
      .map((it) => {
        const t = it.transform;
        const x = t[4] ?? 0;
        const y = t[5] ?? 0;
        return { str: it.str, x, y };
      })
      .sort((a, b) => {
        const rowTol = 3;
        if (Math.abs(a.y - b.y) > rowTol) return b.y - a.y;
        return a.x - b.x;
      });

    const reading_order_text = withPos.map((w) => w.str).join(" ");
    const layout_quality: PdfPageJson["layout_quality"] =
      withPos.length === 0 ? "low" : withPos.length < 3 ? "medium" : "unknown";

    pages.push({
      page_number: i,
      reading_order_text,
      layout_quality,
    });
  }

  return pages;
}
