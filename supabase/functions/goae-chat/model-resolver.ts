/**
 * Normalisiert Modellnamen und bietet sichere Fallbacks,
 * damit das AI-Gateway auch bei Provider-/Modell-Ausfällen weiterläuft.
 */

const DEFAULT_FREE_MODEL = "google/gemma-3n-e2b-it:free";

const KNOWN_ALIASES: Record<string, string> = {
  "openrouter/free": DEFAULT_FREE_MODEL,
};

export function resolveModel(input?: string): string {
  const requested = (input || "").trim();
  if (!requested) return DEFAULT_FREE_MODEL;
  return KNOWN_ALIASES[requested] ?? requested;
}

export function buildFallbackModels(input?: string): string[] {
  const primary = resolveModel(input);
  const candidates = [
    primary,
    DEFAULT_FREE_MODEL,
    "google/gemini-2.0-flash-lite-001",
    "openai/gpt-4o-mini",
  ];

  // Keep order, remove duplicates/empty.
  return [...new Set(candidates.filter(Boolean))];
}

export function isRetryableModelStatus(status: number): boolean {
  return [400, 402, 404, 408, 429, 500, 502, 503].includes(status);
}
