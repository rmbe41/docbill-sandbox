/**
 * Spec 7.3 – Demo-Pipeline: legt optional einen manuellen Prüfeintrag an (LLM-Anbindung später).
 * POST + `Authorization: Bearer $CRON_SECRET` (oder manueller Aufruf).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

  const { count } = await sb
    .from("kb_beschluesse_review")
    .select("id", { count: "exact", head: true })
    .is("decision", null)
    .limit(1);

  if ((count ?? 0) > 0) {
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "queue_nonempty" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data, error } = await sb
    .from("kb_beschluesse_review")
    .insert({
      external_key: "demo:pipeline",
      titel: "Platzhalter: Beschluss manuelle Prüfung",
      quelle: "DEMO",
      relevanz_payload: { kategorie: "indirekt_relevant", begruendung: "Beispiel aus Edge-Function" },
      aktion: "manual_review",
      run_id: `run-${new Date().toISOString().slice(0, 10)}`,
    })
    .select("id")
    .single();

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, id: data?.id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
