import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

/**
 * Spec 07 §9.1 – Verarbeitungsschlange: PII nach 24h bereinigen.
 * Aufruf per Cron (Authorization: Bearer DOCBILL_CRON_SECRET) wie `process-background-job`.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  const cronSecret = Deno.env.get("DOCBILL_CRON_SECRET");
  const auth = req.headers.get("Authorization");
  const headerSecret = req.headers.get("x-docbill-cron-secret");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!cronSecret || (bearer !== cronSecret && headerSecret !== cronSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data, error } = await admin.rpc("purge_job_queue_pii_24h");
  if (error) {
    console.error("purge_job_queue_pii_24h", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, result: data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
