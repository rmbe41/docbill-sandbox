/**
 * Proxy für OpenRouter Credits API.
 * GET https://openrouter.ai/api/v1/credits
 * Erfordert Management-API-Key (OPENROUTER_API_KEY oder OPENROUTER_MANAGEMENT_KEY).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const apiKey = Deno.env.get("OPENROUTER_MANAGEMENT_KEY") ?? Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: "OPENROUTER_API_KEY fehlt",
        total_credits: null,
        total_usage: null,
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/credits", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (resp.status === 403) {
      return new Response(
        JSON.stringify({
          error: "Credits-API erfordert Management-Key (openrouter.ai/settings/keys)",
          total_credits: null,
          total_usage: null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!resp.ok) {
      const text = await resp.text();
      return new Response(
        JSON.stringify({
          error: `OpenRouter: ${resp.status} ${text.slice(0, 200)}`,
          total_credits: null,
          total_usage: null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await resp.json();
    const credits = data?.data ?? data;

    return new Response(
      JSON.stringify({
        total_credits: credits?.total_credits ?? null,
        total_usage: credits?.total_usage ?? null,
        remaining: credits?.total_credits != null && credits?.total_usage != null
          ? credits.total_credits - credits.total_usage
          : null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("goae-credits error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unbekannter Fehler",
        total_credits: null,
        total_usage: null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
