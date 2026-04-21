/**
 * GET — Health & Komponenten-Status (Spec: specs/01_DEV_LIFECYCLE.md §2.3).
 * verify_jwt = false — öffentlich für Monitoring / E2E.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type ComponentState = "ok" | "degraded" | "unknown" | "error";

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  components: {
    database: ComponentState;
    vector_db: ComponentState;
    llm_api: ComponentState;
    goae_json: { status: ComponentState; version: string };
    ebm_json: { status: ComponentState; version: string };
  };
  timestamp: string;
  response_time_ms: number;
}

async function checkDatabase(): Promise<ComponentState> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return "error";
  try {
    const sb = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await sb.from("conversations").select("id").limit(1);
    if (error) {
      console.error(JSON.stringify({ level: "error", msg: "health_db_check", code: error.code }));
      return "error";
    }
    return "ok";
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "health_db_check_exception", detail: String(e) }));
    return "error";
  }
}

async function checkLlmApi(): Promise<ComponentState> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3000);
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
      signal: ac.signal,
    });
    clearTimeout(t);
    if (res.ok || res.status === 401 || res.status === 403) return "ok";
    return "degraded";
  } catch {
    return "unknown";
  }
}

async function sendPostHogHealthCheck(props: {
  overall: string;
  response_time_ms: number;
}): Promise<void> {
  const key = Deno.env.get("POSTHOG_API_KEY");
  const host = Deno.env.get("POSTHOG_HOST") ?? "https://eu.posthog.com";
  if (!key) return;
  const body = {
    api_key: key,
    event: "health_check",
    properties: {
      distinct_id: "edge_health",
      ...props,
    },
  };
  try {
    await fetch(`${host.replace(/\/$/, "")}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* ignore */
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const started = performance.now();
  const [database, llm_api] = await Promise.all([checkDatabase(), checkLlmApi()]);

  const goaeVersion = Deno.env.get("GOAE_JSON_VERSION") ?? "2026-Q2";
  const ebmVersion = Deno.env.get("EBM_JSON_VERSION") ?? "n/a";

  const components: HealthResponse["components"] = {
    database,
    vector_db: "unknown",
    llm_api,
    goae_json: { status: "ok" as ComponentState, version: goaeVersion },
    ebm_json: { status: "unknown" as ComponentState, version: ebmVersion },
  };

  const anyError = database === "error";
  const anyDegraded = !anyError && (llm_api === "degraded" || llm_api === "unknown");

  const status: HealthResponse["status"] = anyError
    ? "unhealthy"
    : anyDegraded
      ? "degraded"
      : "healthy";

  const response_time_ms = Math.round(performance.now() - started);

  const payload: HealthResponse = {
    status,
    components,
    timestamp: new Date().toISOString(),
    response_time_ms,
  };

  await sendPostHogHealthCheck({
    overall: status,
    response_time_ms,
  });

  const httpStatus = anyError ? 503 : 200;
  return new Response(JSON.stringify(payload), {
    status: httpStatus,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
