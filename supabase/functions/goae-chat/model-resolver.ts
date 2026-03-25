/**
 * Normalisiert Modellnamen und bietet sichere Fallbacks,
 * damit das AI-Gateway auch bei Provider-/Modell-Ausfällen weiterläuft.
 */

const DEFAULT_FREE_MODEL = "openrouter/free";

const KNOWN_ALIASES: Record<string, string> = {
  "nvidia/nemotron-3-super:free": "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-nano-12b-2-vl:free": "nvidia/nemotron-nano-12b-v2-vl:free",
};

/** Alle Free-Modelle (abgestimmt mit SettingsContent) – für robuste Fallback-Kette im Testmodus.
 *  Llama weiter hinten, da häufig rate-limited (Venice upstream). */
const ALL_FREE_MODELS = [
  "openrouter/free",
  "openrouter/hunter-alpha",
  "openrouter/healer-alpha",
  "stepfun/step-3.5-flash:free",
  "arcee-ai/trinity-large-preview:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "qwen/qwen3-coder-480b-a35b-instruct:free",
  "z-ai/glm-4.5-air:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "google/gemma-3n-e2b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free", // oft rate-limited, daher hinten
];

/** Free-Modelle für Multimodal (Dokumente/Bilder) – VL-Modelle zuerst, Gemini ausgeschlossen („File data is missing“). */
const MULTIMODAL_SAFE_FALLBACKS = [
  "openrouter/healer-alpha",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "stepfun/step-3.5-flash:free",
  "arcee-ai/trinity-large-preview:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "qwen/qwen3-coder-480b-a35b-instruct:free",
  "z-ai/glm-4.5-air:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "google/gemma-3n-e2b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free", // oft rate-limited
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
    // Bezahlte / explizite Modelle (z. B. google/gemini-2.5-flash): nur dieses eine.
    // Keine stille Kette auf Free-VL-Modelle – sonst wählt der Nutzer Gemini und sieht
    // Timeouts von nemotron/… in der Fehlermeldung.
    if (!isFreeModel(primary)) {
      candidates = [primary];
    } else {
      candidates = [
        primary,
        ...MULTIMODAL_SAFE_FALLBACKS.filter(
          (m) => m !== primary && !m.startsWith("google/gemini"),
        ),
      ];
    }
  } else {
    // Chat / reine Text-Calls: Bezahltes Modell → nur dieses (gleiche Logik wie Multimodal).
    if (!isFreeModel(primary)) {
      candidates = [primary];
    } else {
      const freeFallbacks = ALL_FREE_MODELS.filter((m) => m !== primary);
      candidates = [primary, ...freeFallbacks];
    }
  }

  return [...new Set(candidates.filter(Boolean))];
}

export function isRetryableModelStatus(status: number): boolean {
  return [400, 402, 404, 408, 429, 500, 502, 503].includes(status);
}

const FREE_MODEL_IDS = new Set([
  "openrouter/free",
  "openrouter/hunter-alpha",
  "openrouter/healer-alpha",
]);

export function isFreeModel(model: string): boolean {
  if (!model) return false;
  return FREE_MODEL_IDS.has(model) || model.includes(":free");
}

/** Reasoning-Tokens im Stream können leere Antworten oder Hänger verursachen.
 *  exclude: true sorgt dafür, dass nur die finale Antwort in delta.content ankommt. */
export function getReasoningConfigForStream(_model?: string): { exclude: boolean } {
  return { exclude: true };
}
