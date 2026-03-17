/**
 * Script: PDF in Admin-Kontext importieren
 *
 * Liest eine PDF-Datei, extrahiert Text, erstellt Chunks + Embeddings
 * und speichert in admin_context_files + admin_context_chunks.
 *
 * Ausführung:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENROUTER_API_KEY=... \
 *   npx tsx scripts/import-admin-context-pdf.ts "/pfad/zur/datei.pdf"
 *
 * Oder mit .env.local (wird automatisch geladen falls vorhanden):
 *   npx tsx scripts/import-admin-context-pdf.ts "/pfad/zur/datei.pdf"
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFParse } from "pdf-parse";
import { createClient } from "@supabase/supabase-js";

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const EMBEDDING_DIM = 1536;
const CHUNK_SIZE = 2500;
const CHUNK_OVERLAP = 200;
const MAX_CHUNKS = 100;

function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > start) end = lastNewline + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    start = end - overlap;
  }
  return chunks;
}

async function createEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  const resp = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Embedding API failed: ${resp.status} ${err}`);
  }

  const data = (await resp.json()) as { data?: { index: number; embedding?: number[] }[] };
  const items = data?.data ?? [];
  if (!Array.isArray(items) || items.length !== texts.length) {
    throw new Error("Embedding response format invalid");
  }

  return items
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding)
    .filter((e): e is number[] => Array.isArray(e) && e.length === EMBEDDING_DIM);
}

async function loadEnv(): Promise<void> {
  const dotenv = await import("dotenv");
  dotenv.config({ path: resolve(process.cwd(), ".env.local") });
  dotenv.config({ path: resolve(process.cwd(), ".env") });
}

async function main() {
  await loadEnv();

  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error("Usage: npx tsx scripts/import-admin-context-pdf.ts <path-to-pdf>");
    process.exit(1);
  }

  const sbUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;

  if (!sbUrl || !sbKey || !openRouterKey) {
    console.error(
      "Missing env. Required:\n" +
        "  SUPABASE_URL (or VITE_SUPABASE_URL)\n" +
        "  SUPABASE_SERVICE_ROLE_KEY (Supabase Dashboard → Settings → API)\n" +
        "  OPENROUTER_API_KEY\n\n" +
        "Example: SUPABASE_SERVICE_ROLE_KEY=... OPENROUTER_API_KEY=... npx tsx scripts/import-admin-context-pdf.ts <pdf-path>"
    );
    process.exit(1);
  }

  const resolvedPath = resolve(process.cwd(), pdfPath);
  const filename = pdfPath.split("/").pop() ?? "document.pdf";

  console.log("Reading PDF:", resolvedPath);
  const buffer = await readFile(resolvedPath);

  console.log("Extracting text...");
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  const text = (result as { text?: string }).text ?? "";
  await parser.destroy();

  if (!text.trim()) {
    console.error("PDF contains no extractable text (possibly scanned/image-only).");
    process.exit(1);
  }

  console.log(`Extracted ${text.length} characters. Chunking...`);
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    console.error("No content chunks produced.");
    process.exit(1);
  }
  console.log(`Created ${chunks.length} chunks.`);

  const supabase = createClient(sbUrl, sbKey);

  const { data: admins } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(1);
  const uploadedBy = admins?.[0]?.user_id;
  if (!uploadedBy) {
    console.error("No admin user found in user_roles. Add an admin first.");
    process.exit(1);
  }

  console.log("Creating embeddings...");
  const embeddings = await createEmbeddings(chunks, openRouterKey);

  const { data: fileRow, error: fileError } = await supabase
    .from("admin_context_files")
    .insert({
      filename,
      content_text: text,
      uploaded_by: uploadedBy,
    })
    .select("id")
    .single();

  if (fileError || !fileRow?.id) {
    console.error("Failed to create file record:", fileError?.message ?? "unknown");
    process.exit(1);
  }

  const fileId = fileRow.id;
  console.log("Inserting chunks...");

  for (let i = 0; i < chunks.length; i++) {
    const emb = embeddings[i];
    if (!emb) continue;
    const { error: chunkError } = await supabase.from("admin_context_chunks").insert({
      file_id: fileId,
      filename,
      chunk_index: i,
      content: chunks[i],
      embedding: emb,
    });
    if (chunkError) {
      console.error(`Failed to insert chunk ${i}:`, chunkError.message);
      process.exit(1);
    }
  }

  console.log(`Done. File ID: ${fileId}, ${chunks.length} chunks.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
