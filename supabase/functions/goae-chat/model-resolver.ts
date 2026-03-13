/**
 * Normalisiert Modellnamen und bietet sichere Fallbacks,
 * damit das AI-Gateway auch bei Provider-/Modell-Ausfällen weiterläuft.
 */

const DEFAULT_FREE_MODEL = "openrouter/free";

const KNOWN_ALIASES: Record<string, string> = {};

/** Free-Modelle für Multimodal (Dokumente/Bilder) – Gemini hat oft "File data is missing". */
const MULTIMODAL_SAFE_FALLBACKS = [
  "nvidia/nemotron-nano-12b-2-vl:free",
  "google/gemma-3n-e2b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
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
      "google/gemma-3n-e2b-it:free",
      "meta-llama/llama-3.3-70b-instruct:free",
    ];
  }

  return [...new Set(candidates.filter(Boolean))];
}

export function isRetryableModelStatus(status: number): boolean {
  return [400, 402, 404, 408, 429, 500, 502, 503].includes(status);
}

export function isFreeModel(model: string): boolean {
  if (!model) return false;
  return model === "openrouter/free" || model.includes(":free");
}
