/**
 * PostHog: Custom Event `llm_request` (Spec §2.3).
 * Feuert best-effort; scheitert still bei fehlendem Key.
 */
function resolvePostHogIngestUrl(): string {
  const full = Deno.env.get("POSTHOG_INGEST_URL");
  if (full?.startsWith("http")) {
    return full.replace(/\/$/, "");
  }
  const base = (Deno.env.get("POSTHOG_HOST") ?? "https://eu.i.posthog.com").replace(/\/$/, "");
  const normalized =
    base === "https://eu.posthog.com" ? "https://eu.i.posthog.com" : base;
  return `${normalized}/i/v0/e/`;
}

export async function sendLlmRequestPostHog(props: {
  duration_ms: number;
  model: string;
  success: boolean;
  token_count?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
}): Promise<void> {
  const key = Deno.env.get("POSTHOG_API_KEY");
  if (!key) return;

  const url = resolvePostHogIngestUrl();
  const body = {
    api_key: key,
    event: "llm_request",
    distinct_id: "edge_goae_chat",
    properties: {
      duration_ms: props.duration_ms,
      model: props.model,
      success: props.success,
      prompt_tokens: props.token_count?.prompt,
      completion_tokens: props.token_count?.completion,
      total_tokens: props.token_count?.total,
      source: "supabase_edge_goae_chat",
      $lib: "docbill-goae-chat-llm",
      $process_person_profile: false,
    },
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(
        JSON.stringify({
          level: "warn",
          msg: "posthog_llm_request_http",
          status: res.status,
        }),
      );
    }
  } catch (e) {
    console.error(JSON.stringify({ level: "warn", msg: "posthog_llm_request_failed", detail: String(e) }));
  }
}
