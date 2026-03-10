/**
 * Normalisiert Modellnamen und bietet sichere Fallbacks,
 * damit das AI-Gateway auch bei Provider-/Modell-Ausfällen weiterläuft.
 */

const DEFAULT_FREE_MODEL = "google/gemma-3n-e2b-it:free";

const KNOWN_ALIASES: Record<string, string> = {
  "openrouter/free": DEFAULT_FREE_MODEL,
};

/** Modelle, die mit Dateien/Bildern über OpenRouter funktionieren (Google Gemini: "File data is missing"). */
const MULTIMODAL_SAFE_FALLBACKS = [
  "anthropic/claude-3.5-sonnet",
  "anthropic/claude-3-haiku",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
];

export function resolveModel(input?: string): string {
  const requested = (input || "").trim();
  if (!requested) return DEFAULT_FREE_MODEL;
  return KNOWN_ALIASES[requested] ?? requested;
}

export function buildFallbackModels(
  input?: string,
  opts?: { multimodal?: boolean },
): string[] {
  const primary = resolveModel(input);
  const multimodal = opts?.multimodal ?? false;

  let candidates: string[];
  if (multimodal) {
    candidates = [primary, ...MULTIMODAL_SAFE_FALLBACKS].filter(
      (m) => !m.startsWith("google/gemini")
    );
  } else {
    candidates = [
      primary,
      DEFAULT_FREE_MODEL,
      "google/gemini-2.0-flash-lite-001",
      "openai/gpt-4o-mini",
    ];
  }

  return [...new Set(candidates.filter(Boolean))];
}

export function isRetryableModelStatus(status: number): boolean {
  return [400, 402, 404, 408, 429, 500, 502, 503].includes(status);
}
