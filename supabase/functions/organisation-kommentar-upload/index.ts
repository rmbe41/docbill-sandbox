/**
 * Spec 05 §7.4: GOÄ-Kommentarliteratur pro Organisation
 * (Text clientseitig extrahiert, Chunking + Embeddings wie admin-context-upload)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const EMBEDDING_DIM = 1536;
const CHUNK_SIZE = 2500;
const CHUNK_OVERLAP = 200;
const MAX_CHUNKS_DEFAULT = 100;
const EMBEDDING_TIMEOUT_MS = 60000;

const QUELLE_SET = new Set(["brueck", "hoffmann", "lang_schaefer"]);

function effectiveMaxChunks(): number {
  const raw = Deno.env.get("ORG_KOMMENTAR_MAX_CHUNKS") ?? Deno.env.get("ADMIN_CONTEXT_MAX_CHUNKS");
  if (!raw) return MAX_CHUNKS_DEFAULT;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : MAX_CHUNKS_DEFAULT;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 30000, ...fetchInit } = init;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...fetchInit, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function guessChunkZiffern(content: string): string[] {
  const s = new Set<string>();
  for (const m of content.matchAll(/\bGOÄ\s*(\d{1,4}[a-z]?|[A-Z]\d{0,4})\b/gi)) {
    s.add(m[1].trim());
  }
  for (const m of content.matchAll(/\b(\d{3,4})\b/g)) {
    const n = m[1];
    if (/^(19|20)\d{2}$/.test(n)) continue;
    s.add(n);
  }
  return [...s].slice(0, 48);
}

function chunkText(
  text: string,
  chunkSize = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
  maxChunks = effectiveMaxChunks(),
): { chunks: string[]; truncated: boolean } {
  const chunks: string[] = [];
  let start = 0;
  let lastEnd = 0;
  while (start < text.length && chunks.length < maxChunks) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > start) end = lastNewline + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    lastEnd = end;
    if (end >= text.length) break;
    start = Math.max(0, end - overlap);
  }
  const truncated = lastEnd < text.length;
  return { chunks, truncated };
}

async function createEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  const resp = await fetchWithTimeout("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
    timeoutMs: EMBEDDING_TIMEOUT_MS,
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Embedding API failed: ${resp.status} ${err}`);
  }
  const data = await resp.json();
  const items = data?.data ?? [];
  if (!Array.isArray(items) || items.length !== texts.length) {
    throw new Error("Embedding response format invalid");
  }
  return items
    .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
    .map((item: { embedding?: number[] }) => item.embedding)
    .filter((e): e is number[] => Array.isArray(e) && e.length === EMBEDDING_DIM);
}

function parseUserIdFromBearer(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { sub?: string };
    return payload?.sub ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Authorization required" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.replace("Bearer ", "").trim();
  const userId = parseUserIdFromBearer(token);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sbUrl = Deno.env.get("SUPABASE_URL");
  const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!sbUrl || !sbKey || !openRouterKey) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = (await req.json()) as {
    quelle?: string;
    filename?: string;
    content_text?: string;
    file_base64?: string;
  };

  const quelle = typeof body.quelle === "string" ? body.quelle.trim() : "";
  if (!QUELLE_SET.has(quelle)) {
    return new Response(JSON.stringify({ error: "quelle muss brueck, hoffmann oder lang_schaefer sein" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const filename = body.filename;
  if (!filename || typeof body.content_text !== "string") {
    return new Response(JSON.stringify({ error: "filename and content_text required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const text = body.content_text.trim();
  if (!text) {
    return new Response(JSON.stringify({ error: "content_text must not be empty" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const memResp = await fetch(
    `${sbUrl}/rest/v1/organisation_members?user_id=eq.${userId}&select=organisation_id,role`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } },
  );
  if (!memResp.ok) {
    const t = await memResp.text();
    return new Response(JSON.stringify({ error: `Organisation: ${t || memResp.status}` }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const memRows = (await memResp.json()) as { organisation_id?: string; role?: string }[];
  const mem = Array.isArray(memRows) ? memRows[0] : null;
  if (!mem?.organisation_id) {
    return new Response(JSON.stringify({ error: "Keine Organisation für diesen Account" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (mem.role === "viewer") {
    return new Response(JSON.stringify({ error: "Keine Berechtigung (nur Lesen)" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const organisationId = mem.organisation_id;

  const orgRowResp = await fetch(
    `${sbUrl}/rest/v1/organisations?id=eq.${organisationId}&select=settings`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } },
  );
  if (orgRowResp.ok) {
    const orgRows = (await orgRowResp.json()) as { settings?: Record<string, unknown> }[];
    const raw = orgRows?.[0]?.settings;
    const custom =
      raw && typeof raw === "object" && "customWissensbasis" in raw
        ? (raw as { customWissensbasis?: boolean }).customWissensbasis
        : undefined;
    if (custom === false) {
      return new Response(
        JSON.stringify({
          error: "Eigene / lizenzierte Wissensbasis ist für diese Organisation deaktiviert (Spec 13.1).",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  const supabase = createClient(sbUrl, sbKey);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const writeProgress = (step: string, skipped = false) => {
        controller.enqueue(
          encoder.encode(
            JSON.stringify(skipped ? { type: "progress", step, skipped: true } : { type: "progress", step }) +
              "\n",
          ),
        );
      };

      try {
        writeProgress("send");
        const maxC = effectiveMaxChunks();
        const { chunks, truncated } = chunkText(text);
        if (chunks.length === 0) {
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "error", message: "No content chunks produced" }) + "\n"),
          );
          return;
        }
        writeProgress("chunk");

        const embeddings = await createEmbeddings(chunks, openRouterKey);
        writeProgress("embed");

        const delResp = await fetch(
          `${sbUrl}/rest/v1/organisation_kommentar_files?organisation_id=eq.${organisationId}&quelle=eq.${quelle}`,
          {
            method: "DELETE",
            headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
          },
        );
        if (!delResp.ok) {
          const t = await delResp.text();
          throw new Error(`Konnte alte Version nicht löschen: ${t}`);
        }
        writeProgress("db_clear");

        let storagePath: string | null = null;
        const isPdf = filename.toLowerCase().endsWith(".pdf");
        if (isPdf && typeof body.file_base64 === "string" && body.file_base64.length > 0) {
          try {
            const binary = Uint8Array.from(atob(body.file_base64), (c) => c.charCodeAt(0));
            const path = `${organisationId}/${quelle}/${crypto.randomUUID()}.pdf`;
            const { error: uploadErr } = await supabase.storage
              .from("org-kommentar")
              .upload(path, binary, { contentType: "application/pdf", upsert: false });
            if (!uploadErr) storagePath = path;
          } catch (e) {
            console.warn("org-kommentar storage upload failed:", e);
          }
        }
        if (storagePath) writeProgress("store_pdf");
        else writeProgress("store_pdf", true);

        const fileResp = await fetch(`${sbUrl}/rest/v1/organisation_kommentar_files`, {
          method: "POST",
          headers: {
            apikey: sbKey,
            Authorization: `Bearer ${sbKey}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            organisation_id: organisationId,
            quelle,
            filename,
            content_text: text,
            storage_path: storagePath,
            uploaded_by: userId,
          }),
        });
        if (!fileResp.ok) {
          const err = await fileResp.text();
          throw new Error(`Failed to create file record: ${err}`);
        }
        const fileRows = await fileResp.json();
        const fileId = Array.isArray(fileRows) ? fileRows[0]?.id : fileRows?.id;
        if (!fileId) throw new Error("No file id returned");
        writeProgress("db_file");

        for (let i = 0; i < chunks.length; i++) {
          const emb = embeddings[i];
          if (!emb) continue;
          const chunkResp = await fetch(`${sbUrl}/rest/v1/organisation_kommentar_chunks`, {
            method: "POST",
            headers: {
              apikey: sbKey,
              Authorization: `Bearer ${sbKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              organisation_id: organisationId,
              file_id: fileId,
              filename,
              chunk_index: i,
              content: chunks[i],
              embedding: emb,
              ziffern: guessChunkZiffern(chunks[i]),
            }),
          });
          if (!chunkResp.ok) {
            const err = await chunkResp.text();
            throw new Error(`Failed to insert chunk ${i}: ${err}`);
          }
        }
        writeProgress("db_chunks");

        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: "complete",
              ok: true,
              file_id: fileId,
              chunks: chunks.length,
              truncated,
              max_chunks: maxC,
            }) + "\n",
          ),
        );
      } catch (e) {
        console.error("organisation-kommentar-upload error:", e);
        const msg = e instanceof Error ? e.message : "Upload failed";
        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: msg }) + "\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  });
});
