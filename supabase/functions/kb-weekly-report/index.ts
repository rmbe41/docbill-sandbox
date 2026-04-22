/**
 * Spec 7.3 – Wöchentlicher Report (aggregiert) in `kb_relevanz_reports`.
 * POST + `Authorization: Bearer $CRON_SECRET`.
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

  const { count: pending } = await sb
    .from("kb_beschluesse_review")
    .select("id", { count: "exact", head: true })
    .is("decision", null);

  const { count: total } = await sb.from("kb_beschluesse_review").select("id", { count: "exact", head: true });

  const d = new Date();
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  const weekStart = d.toISOString().slice(0, 10);

  const { data, error } = await sb
    .from("kb_relevanz_reports")
    .insert({
      week_start: weekStart,
      payload: {
        pending: pending ?? 0,
        total: total ?? 0,
        generatedAt: new Date().toISOString(),
      } as Record<string, unknown>,
    })
    .select("id")
    .single();

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, reportId: data?.id, week_start: weekStart, pending, total }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
