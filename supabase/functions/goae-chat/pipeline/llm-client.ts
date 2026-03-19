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
      if (i === modelsToTry.length - 1) throw new Error(lastError);
      continue;
    }

    try {
      if (resp.ok) {
        const data = await resp.json();
        clearTimeout(timeoutId);
        const content = data.choices?.[0]?.message?.content;
        if (content == null) return "";
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
          const textParts = content
            .filter((p: { type?: string; text?: string }) => p?.type === "text" && p?.text)
            .map((p: { text?: string }) => p.text as string);
          if (textParts.length > 0) return textParts.join("\n");
        }
        if (content && typeof content === "object" && "text" in content && typeof (content as { text?: string }).text === "string") {
          return (content as { text: string }).text;
        }
        return String(content);
      }

      const text = await resp.text();
      clearTimeout(timeoutId);
      lastError = `LLM-Aufruf fehlgeschlagen (${resp.status}) mit Modell ${modelsToTry[i]}: ${text}`;
      if (!isRetryableModelStatus(resp.status) || i === modelsToTry.length - 1) {
        throw new Error(lastError);
      }
    } catch (e) {
      clearTimeout(timeoutId);
      const isAbort = e instanceof Error && e.name === "AbortError";
      if (isAbort) {
        lastError = `LLM-Aufruf Timeout (${LLM_FETCH_TIMEOUT_MS / 1000}s) – Modell ${modelsToTry[i]} antwortet nicht`;
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

/** Entfernt typische LLM-JSON-Fehler (trailing commas, BOM, Steuerzeichen). */
function sanitizeForJson(s: string): string {
  let out = s
    .replace(/^\uFEFF/, "") // BOM
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ") // Steuerzeichen
    .trim();
  // Trailing comma vor } oder ]
  out = out.replace(/,(\s*[}\]])/g, "$1");
  return out;
}

/** Findet die passende schließende Klammer für { oder [ an Position start (berücksichtigt Strings). */
function findMatchingBrace(str: string, start: number): number {
  const open = str[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  let quote = '"';
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      quote = c;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function tryParse<T>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

/**
 * Extrahiert JSON aus einem LLM-Response-String.
 * Robust gegen leere Antworten, Markdown-Wrapper, trailing commas, BOM.
 */
export function extractJson<T>(raw: string): T {
  if (!raw || typeof raw !== "string") {
    throw new Error(
      "Konnte kein gültiges JSON extrahieren: LLM-Antwort war leer oder ungültig.",
    );
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(
      "Konnte kein gültiges JSON extrahieren: LLM-Antwort war leer.",
    );
  }

  // 1. Direkt parsen
  let result = tryParse<T>(trimmed);
  if (result !== null) return result;

  // 2. Sanitized parsen (trailing commas, BOM, Steuerzeichen)
  const sanitized = sanitizeForJson(trimmed);
  result = tryParse<T>(sanitized);
  if (result !== null) return result;

  // 3. Markdown-Codeblock ```json ... ```
  const jsonBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch) {
    const block = sanitizeForJson(jsonBlockMatch[1]);
    result = tryParse<T>(block);
    if (result !== null) return result;
  }

  // 4. Erstes { bis passende } (balanciert, berücksichtigt } in Strings)
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace !== -1) {
    const lastBrace = findMatchingBrace(trimmed, firstBrace);
    if (lastBrace !== -1) {
      const slice = sanitizeForJson(trimmed.slice(firstBrace, lastBrace + 1));
      result = tryParse<T>(slice);
      if (result !== null) return result;
    }
  }

  // 5. Erstes [ bis passende ] (balanciert, für Array-Responses)
  const firstBracket = trimmed.indexOf("[");
  if (firstBracket !== -1) {
    const lastBracket = findMatchingBrace(trimmed, firstBracket);
    if (lastBracket !== -1) {
      const slice = sanitizeForJson(trimmed.slice(firstBracket, lastBracket + 1));
      result = tryParse<T>(slice);
      if (result !== null) return result;
    }
  }

  const preview = trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
  throw new Error(
    `Konnte kein gültiges JSON aus der LLM-Antwort extrahieren. Vorschau: "${preview.replace(/\n/g, " ")}"`,
  );
}

