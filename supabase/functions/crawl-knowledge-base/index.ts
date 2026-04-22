/**
 * Spec 7.2 – Crawl-Job (Hintergrund): Fetch, Metadaten, Text-Stub, Fehler-Logging.
 * Trigger: GitHub Actions / Cron mit `Authorization: Bearer $CRON_SECRET`.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const PLACEHOLDER_URL = "https://example.com/";

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

  const secret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "server_misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: runRow, error: runErr } = await sb
    .from("kb_crawl_runs")
    .insert({ source_name: "example_placeholder", status: "running" })
    .select("id")
    .single();

  if (runErr || !runRow) {
    console.error(JSON.stringify({ msg: "crawl_run_insert", err: runErr?.message }));
    return new Response(JSON.stringify({ ok: false, error: runErr?.message ?? "insert" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const runId = runRow.id as string;

  try {
    const res = await fetch(PLACEHOLDER_URL, { redirect: "follow" });
    const text = res.ok ? await res.text() : "";
    const h = text ? await sha256Hex(text) : "empty";
    const { error: docErr } = await sb.from("kb_crawl_documents").insert({
      run_id: runId,
      source_url: PLACEHOLDER_URL,
      content_hash: h,
      text_extract: text.slice(0, 32_000),
      byte_length: new TextEncoder().encode(text).length,
    });
    if (docErr) {
      throw new Error(docErr.message);
    }
    const { error: upErr } = await sb
      .from("kb_crawl_runs")
      .update({
        status: "ok",
        finished_at: new Date().toISOString(),
        document_count: 1,
        log: { url: PLACEHOLDER_URL, http: res.status } as Record<string, unknown>,
      })
      .eq("id", runId);
    if (upErr) throw new Error(upErr.message);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb
      .from("kb_crawl_runs")
      .update({ status: "error", finished_at: new Date().toISOString(), error_message: msg })
      .eq("id", runId);
    console.error(JSON.stringify({ level: "error", msg: "crawl_failed", runId, detail: msg }));
    return new Response(JSON.stringify({ ok: false, runId, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, runId }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
