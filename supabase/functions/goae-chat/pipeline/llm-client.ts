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

export interface LlmCallOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: unknown[];
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  plugins?: unknown[];
}

export async function callLlm(opts: LlmCallOptions): Promise<string> {
  const modelsToTry = buildFallbackModels(opts.model);
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

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

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

