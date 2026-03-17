/**
 * Shared LLM-Aufruf-Helfer für Pipeline-Schritte.
 * Nutzt OpenRouter API – sowohl für JSON-Extraktion (non-streaming)
 * als auch für Text-Generierung (streaming).
 */
import { fetchWithTimeout } from "../fetch-with-timeout.ts";
import {
  buildFallbackModels,
  isRetryableModelStatus,
  resolveModel,
} from "../model-resolver.ts";

/** Timeout für LLM-Aufrufe (90s) – verhindert endloses Hängen bei langsamen Providern */
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

  for (let i = 0; i < modelsToTry.length; i++) {
    const body: Record<string, unknown> = {
      model: modelsToTry[i],
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userContent },
      ],
      stream: false,
      temperature: opts.temperature ?? 0.1,
      max_tokens: opts.maxTokens ?? 4096,
    };

    if (opts.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    if (opts.plugins) {
      body.plugins = opts.plugins;
    }

    let resp: Response;
    try {
      resp = await fetchWithTimeout(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          timeoutMs: LLM_FETCH_TIMEOUT_MS,
        },
      );
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      lastError = isAbort
        ? `LLM-Aufruf Timeout (${LLM_FETCH_TIMEOUT_MS / 1000}s) – Modell ${modelsToTry[i]} antwortet nicht`
        : (e instanceof Error ? e.message : String(e));
      if (i === modelsToTry.length - 1) throw new Error(lastError);
      continue;
    }

    if (resp.ok) {
      const data = await resp.json();
      return data.choices?.[0]?.message?.content ?? "";
    }

    const text = await resp.text();
    lastError = `LLM-Aufruf fehlgeschlagen (${resp.status}) mit Modell ${modelsToTry[i]}: ${text}`;
    if (!isRetryableModelStatus(resp.status) || i === modelsToTry.length - 1) {
      throw new Error(lastError);
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

/**
 * Extrahiert JSON aus einem LLM-Response-String.
 * Versucht zuerst direktes Parsen, dann sucht es nach ```json blocks.
 */
export function extractJson<T>(raw: string): T {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Try to find JSON in markdown code block
  }

  const jsonBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch) {
    return JSON.parse(jsonBlockMatch[1].trim()) as T;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1)) as T;
  }

  throw new Error("Konnte kein gültiges JSON aus der LLM-Antwort extrahieren");
}

