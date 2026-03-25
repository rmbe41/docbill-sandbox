/**
 * CLI: PDF einlesen → Manifest + Seiten-JSON (ohne Embedding; für Pipelines-Tests).
 *
 *   npx tsx scripts/pdf-ingest/ingest-cli.ts path/to.pdf ./out-dir
 */

import { mkdir, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extractPdfPagesFromBuffer } from "./extract-pdf.ts";
import type { PdfIngestManifest } from "./types.ts";

const CHUNK_SIZE = 2500;
const CHUNK_OVERLAP = 200;
const MAX_CHUNKS = 2000;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > start) end = nl + 1;
    }
    const c = text.slice(start, end).trim();
    if (c.length) chunks.push(c);
    if (end >= text.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks;
}

async function main() {
  const pdfPath = process.argv[2];
  const outDir = process.argv[3] ?? "./pdf-ingest-out";
  if (!pdfPath) {
    console.error("Usage: npx tsx scripts/pdf-ingest/ingest-cli.ts <file.pdf> [out-dir]");
    process.exit(1);
  }

  const buf = await readFile(pdfPath);
  const hash = createHash("sha256").update(buf).digest("hex");
  const pages = await extractPdfPagesFromBuffer(buf);
  const fullText = pages.map((p) => p.reading_order_text).join("\n\n");
  const chunks = chunkText(fullText);
  const truncated = chunks.length >= MAX_CHUNKS && fullText.length > chunks.join().length;

  await mkdir(outDir, { recursive: true });

  const document_id = basename(pdfPath, ".pdf") + "_" + hash.slice(0, 8);

  const manifest: PdfIngestManifest = {
    document_id,
    title: basename(pdfPath),
    page_count: pages.length,
    pdf_sha256: hash,
    imported_at: new Date().toISOString(),
    truncated,
    truncation_reason: truncated ? `chunk_cap_${MAX_CHUNKS}` : undefined,
    extractor: "pdfjs-order",
  };

  await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2), "utf-8");
  await writeFile(`${outDir}/pages.json`, JSON.stringify(pages, null, 2), "utf-8");
  await writeFile(
    `${outDir}/chunks-preview.json`,
    JSON.stringify(
      { count: chunks.length, first: chunks[0]?.slice(0, 500) },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir,
        pages: pages.length,
        chunks: chunks.length,
        truncated,
        sha256: hash,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
