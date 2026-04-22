/**
 * Shared LLM-Aufruf-Helfer für Pipeline-Schritte.
 * Nutzt OpenRouter API – sowohl für JSON-Extraktion (non-streaming)
 * als auch für Text-Generierung (streaming).
 */
import {
  buildFallbackModels,
  isRetryableModelStatus,
  resolveModel,
} from "../model-resolver.ts";
import { sendLlmRequestPostHog } from "../posthog-llm.ts";
import type { PseudonymRequestContext } from "../privacy/pseudonym-request-context.ts";
import { getPseudonymRequestContext } from "../privacy/pseudonym-request-context.ts";
import { pseudonymizeForLlmSession } from "../privacy/pseudonymize-orchestrator.ts";
import { loadPseudonymMap } from "../privacy/pseudonym-redis.ts";
import { reidentifyText } from "../privacy/pseudonymize-bridge.ts";

export { extractJson } from "./extract-json.ts";

/** Timeout für LLM-Aufrufe (90s) – deckt fetch UND Body-Lesen ab (resp.json() kann sonst endlos hängen) */
const LLM_FETCH_TIMEOUT_MS = 90000;

export interface LlmCallOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: unknown[];
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  plugins?: unknown[];
  /** When true, use only the specified model (no fallbacks). Used for parser retries. */
  skipFallbacks?: boolean;
  /** Interne Hilfsaufrufe (z. B. NER Stufe 2) — keine Pseudonymisierung, vermeidet Rekursion. */
  skipPseudonymOutbound?: boolean;
  /** Expliziter Kontext; sonst `getPseudonymRequestContext()` (Request-ALS). */
  pseudonymToExternal?: PseudonymRequestContext;
}

async function maybeReidentifyLlmText(text: string, pseudo: PseudonymRequestContext | undefined): Promise<string> {
  if (!pseudo?.sessionId || !text) return text;
  const map = await loadPseudonymMap(pseudo.sessionId);
  if (!map?.mappings.length) return text;
  return reidentifyText(text, map);
}

export async function callLlm(opts: LlmCallOptions): Promise<string> {
  const hasMultimodal = opts.userContent.some((part) => {
    if (!part || typeof part !== "object") return false;
    const t = (part as { type?: string }).type;
    return t === "file" || t === "image_url";
  });
  const modelsToTry = opts.skipFallbacks
    ? [opts.model]
    : buildFallbackModels(opts.model, { multimodal: hasMultimodal });
  let lastError = "Unbekannter Fehler";

  const pseudo = opts.skipPseudonymOutbound
    ? undefined
    : (opts.pseudonymToExternal ?? getPseudonymRequestContext());

  let systemPrompt = opts.systemPrompt;
  let userContent = opts.userContent;
  if (pseudo?.sessionId) {
    const s = await pseudonymizeForLlmSession({
      plaintext: systemPrompt,
      sessionId: pseudo.sessionId,
      apiKey: pseudo.apiKey,
      model: pseudo.model,
    });
    systemPrompt = s.text;
    userContent = await Promise.all(
      opts.userContent.map(async (part) => {
        if (!part || typeof part !== "object") return part;
        const o = part as Record<string, unknown>;
        if (o.type === "text" && typeof o.text === "string") {
          const r = await pseudonymizeForLlmSession({
            plaintext: o.text,
            sessionId: pseudo.sessionId,
            apiKey: pseudo.apiKey,
            model: pseudo.model,
          });
          return { ...o, text: r.text };
        }
        return part;
      }),
    );
  }

  for (let i = 0; i < modelsToTry.length; i++) {
    const modelUsed = modelsToTry[i];
    const body: Record<string, unknown> = {
      model: modelUsed,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      stream: false,
      temperature: opts.temperature ?? 0.1,
      max_tokens: opts.maxTokens ?? 4096,
    };

    if (opts.jsonMode) {
      body.response_format = { type: "json_object" };
      const pluginsList = (opts.plugins ? [...(Array.isArray(opts.plugins) ? opts.plugins : [opts.plugins])] : []) as { id: string }[];
      if (!pluginsList.some((p) => p.id === "response-healing")) {
        pluginsList.unshift({ id: "response-healing" });
      }
      body.plugins = pluginsList;
    } else if (opts.plugins) {
      body.plugins = opts.plugins;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_FETCH_TIMEOUT_MS);
    const reqStarted = performance.now();

    let resp: Response;
    try {
      resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timeoutId);
      const isAbort = e instanceof Error && e.name === "AbortError";
      lastError = isAbort
        ? `LLM-Aufruf Timeout (${LLM_FETCH_TIMEOUT_MS / 1000}s) – Modell ${modelsToTry[i]} antwortet nicht`
        : (e instanceof Error ? e.message : String(e));
      const durationMs = Math.round(performance.now() - reqStarted);
      await sendLlmRequestPostHog({
        duration_ms: durationMs,
        model: modelUsed,
        success: false,
      });
      if (i === modelsToTry.length - 1) throw new Error(lastError);
      continue;
    }

    try {
      if (resp.ok) {
        const data = (await resp.json()) as {
          choices?: { message?: { content?: unknown } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        clearTimeout(timeoutId);
        const durationMs = Math.round(performance.now() - reqStarted);
        const u = data.usage;
        await sendLlmRequestPostHog({
          duration_ms: durationMs,
          model: modelUsed,
          success: true,
          token_count: u
            ? {
                prompt: u.prompt_tokens,
                completion: u.completion_tokens,
                total: u.total_tokens,
              }
            : undefined,
        });
        const content = data.choices?.[0]?.message?.content;
        if (content == null) return "";
        if (typeof content === "string") return await maybeReidentifyLlmText(content, pseudo);
        if (Array.isArray(content)) {
          const textParts = content
            .filter((p: { type?: string; text?: string }) => p?.type === "text" && p?.text)
            .map((p: { text?: string }) => p.text as string);
          if (textParts.length > 0) {
            return await maybeReidentifyLlmText(textParts.join("\n"), pseudo);
          }
        }
        if (content && typeof content === "object" && "text" in content && typeof (content as { text?: string }).text === "string") {
          return await maybeReidentifyLlmText((content as { text: string }).text, pseudo);
        }
        return await maybeReidentifyLlmText(String(content), pseudo);
      }

      const text = await resp.text();
      clearTimeout(timeoutId);
      const durationMs = Math.round(performance.now() - reqStarted);
      await sendLlmRequestPostHog({
        duration_ms: durationMs,
        model: modelUsed,
        success: false,
      });
      lastError = `LLM-Aufruf fehlgeschlagen (${resp.status}) mit Modell ${modelsToTry[i]}: ${text}`;
      if (!isRetryableModelStatus(resp.status) || i === modelsToTry.length - 1) {
        throw new Error(lastError);
      }
    } catch (e) {
      clearTimeout(timeoutId);
      const isAbort = e instanceof Error && e.name === "AbortError";
      if (isAbort) {
        lastError = `LLM-Aufruf Timeout (${LLM_FETCH_TIMEOUT_MS / 1000}s) – Modell ${modelsToTry[i]} antwortet nicht`;
        const durationMs = Math.round(performance.now() - reqStarted);
        await sendLlmRequestPostHog({
          duration_ms: durationMs,
          model: modelUsed,
          success: false,
        });
        if (i === modelsToTry.length - 1) throw new Error(lastError);
        continue;
      }
      throw e;
    }
  }

  throw new Error(lastError);
}

/**
 * Selects an appropriate model for structured extraction.
 * Free models can be flaky, so we normalize aliases first.
 */
export function pickExtractionModel(userModel: string): string {
  return resolveModel(userModel);
}

