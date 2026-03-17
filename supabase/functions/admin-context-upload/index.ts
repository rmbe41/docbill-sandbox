/**
 * Admin Context Upload – RAG-ready
 *
 * Accepts filename + content_text from frontend (PDF text extracted client-side).
 * For PDFs, optionally accepts file_base64 to store the original for preview.
 * Chunks the content, creates embeddings via OpenRouter, stores in admin_context_files
 * and admin_context_chunks.
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sbUrl = Deno.env.get("SUPABASE_URL");
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!sbUrl || !sbKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.replace("Bearer ", "").trim();
    let userId: string | null = null;
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const base64Url = parts[1];
        const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
        const payload = JSON.parse(atob(padded));
        userId = payload?.sub ?? null;
      }
    } catch {
      /* ignore */
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const roleRow = await fetch(
      `${sbUrl}/rest/v1/user_roles?user_id=eq.${userId}&select=role`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } },
    ).then((r) => r.json());

    const isAdmin = Array.isArray(roleRow) && roleRow.some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Admin role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json() as { filename?: string; content_text?: string; migrate?: boolean; check_unindexed?: boolean };

    if (body?.check_unindexed === true) {
      const filesResp = await fetch(
        `${sbUrl}/rest/v1/admin_context_files?select=id`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } },
      );
      if (!filesResp.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to fetch files" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const files = (await filesResp.json()) as { id: string }[];
      let unindexed = 0;
      const indexed: string[] = [];
      for (const f of files ?? []) {
        const chunkResp = await fetch(
          `${sbUrl}/rest/v1/admin_context_chunks?file_id=eq.${f.id}&select=id&limit=1`,
          { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } },
        );
        if (!chunkResp.ok) continue;
        const chunks = await chunkResp.json();
        if (Array.isArray(chunks) && chunks.length > 0) {
          indexed.push(f.id);
        } else {
          unindexed++;
        }
      }
      return new Response(
        JSON.stringify({ unindexed, indexed }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (body?.migrate === true) {
      const filesResp = await fetch(
        `${sbUrl}/rest/v1/admin_context_files?select=id,filename,content_text`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } },
      );
      if (!filesResp.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to fetch files" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const files = await filesResp.json();
      let migratedFiles = 0;
      for (const f of files ?? []) {
        const fileId = f?.id;
        const filename = f?.filename ?? "unknown";
        const contentText = f?.content_text ?? "";
        if (!fileId || !contentText.trim()) continue;
        const existingResp = await fetch(
          `${sbUrl}/rest/v1/admin_context_chunks?file_id=eq.${fileId}&select=id`,
          { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } },
        );
        const existing = await existingResp.json();
        if (Array.isArray(existing) && existing.length > 0) continue;
        const chunks = chunkText(contentText);
        if (chunks.length === 0) continue;
        const embeddings = await createEmbeddings(chunks, openRouterKey);
        let ok = true;
        for (let i = 0; i < chunks.length; i++) {
          const emb = embeddings[i];
          if (!emb) continue;
          const chunkResp = await fetch(`${sbUrl}/rest/v1/admin_context_chunks`, {
            method: "POST",
            headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ file_id: fileId, filename, chunk_index: i, content: chunks[i], embedding: emb }),
          });
          if (!chunkResp.ok) ok = false;
        }
        if (ok) migratedFiles++;
      }
      return new Response(
        JSON.stringify({ ok: true, migrated: migratedFiles }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { filename, content_text, file_base64 } = body;

    if (!filename || typeof content_text !== "string") {
      return new Response(
        JSON.stringify({ error: "filename and content_text required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const text = content_text.trim();
    if (!text) {
      return new Response(
        JSON.stringify({ error: "content_text must not be empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      return new Response(
        JSON.stringify({ error: "No content chunks produced" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const embeddings = await createEmbeddings(chunks, openRouterKey);

    let storagePath: string | null = null;
    const isPdf = filename.toLowerCase().endsWith(".pdf");
    if (isPdf && typeof file_base64 === "string" && file_base64.length > 0) {
      try {
        const binary = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0));
        const path = `${userId}/${crypto.randomUUID()}.pdf`;
        const supabase = createClient(sbUrl, sbKey);
        const { error: uploadErr } = await supabase.storage
          .from("admin-context")
          .upload(path, binary, { contentType: "application/pdf", upsert: false });
        if (!uploadErr) storagePath = path;
      } catch (e) {
        console.warn("PDF storage upload failed, continuing without preview:", e);
      }
    }

    const fileResp = await fetch(`${sbUrl}/rest/v1/admin_context_files`, {
      method: "POST",
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        filename,
        content_text: text,
        uploaded_by: userId,
        storage_path: storagePath,
      }),
    });

    if (!fileResp.ok) {
      const err = await fileResp.text();
      throw new Error(`Failed to create file record: ${err}`);
    }

    const fileRows = await fileResp.json();
    const fileId = Array.isArray(fileRows) ? fileRows[0]?.id : fileRows?.id;
    if (!fileId) {
      throw new Error("No file id returned");
    }

    for (let i = 0; i < chunks.length; i++) {
      const emb = embeddings[i];
      if (!emb) continue;
      const chunkResp = await fetch(`${sbUrl}/rest/v1/admin_context_chunks`, {
        method: "POST",
        headers: {
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          file_id: fileId,
          filename,
          chunk_index: i,
          content: chunks[i],
          embedding: emb,
        }),
      });
      if (!chunkResp.ok) {
        const err = await chunkResp.text();
        throw new Error(`Failed to insert chunk ${i}: ${err}`);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, file_id: fileId, chunks: chunks.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("admin-context-upload error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Upload failed",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
