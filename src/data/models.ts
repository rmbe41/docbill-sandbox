export const AVAILABLE_MODELS: { value: string; label: string; desc: string; isFree: boolean }[] = [
  { value: "openrouter/free", label: "OpenRouter Free Router", desc: "Wählt automatisch aus kostenlosen Modellen", isFree: true },
  { value: "openrouter/hunter-alpha", label: "Hunter Alpha", desc: "1T Parameter – Frontier", isFree: true },
  { value: "openrouter/healer-alpha", label: "Healer Alpha", desc: "Omni-modal – Vision + Audio", isFree: true },
  { value: "stepfun/step-3.5-flash:free", label: "Step 3.5 Flash", desc: "StepFun – Reasoning", isFree: true },
  { value: "arcee-ai/trinity-large-preview:free", label: "Trinity Large Preview", desc: "Arcee – Frontier-Scale", isFree: true },
  { value: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super", desc: "NVIDIA – 120B MoE", isFree: true },
  { value: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B", desc: "Meta – multilingual", isFree: true },
  { value: "nvidia/nemotron-nano-12b-2-vl:free", label: "Nemotron Nano 12B VL", desc: "NVIDIA – Dokumente/Bilder", isFree: true },
  { value: "qwen/qwen3-coder-480b-a35b-instruct:free", label: "Qwen3 Coder 480B", desc: "Alibaba – Code/Agentic", isFree: true },
  { value: "z-ai/glm-4.5-air:free", label: "GLM 4.5 Air", desc: "Z.ai – Agentic", isFree: true },
  { value: "mistralai/mistral-small-3.1-24b-instruct:free", label: "Mistral Small 3.1 24B", desc: "Mistral – multimodal", isFree: true },
  { value: "nvidia/nemotron-3-nano-30b-a3b:free", label: "Nemotron 3 Nano 30B", desc: "NVIDIA – effizient", isFree: true },
  { value: "google/gemma-3n-e2b-it:free", label: "Gemma 3n 2B", desc: "Google – klein & schnell", isFree: true },
  { value: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku", desc: "Schnell & zuverlässig", isFree: false },
  { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", desc: "Starke Qualität", isFree: false },
  { value: "openai/gpt-4o-mini", label: "GPT-4o Mini", desc: "OpenAI – ausgewogen", isFree: false },
  { value: "openai/gpt-4o", label: "GPT-4o", desc: "OpenAI – Top-Qualität", isFree: false },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", desc: "Google – schnell", isFree: false },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", desc: "Google – beste Qualität", isFree: false },
];

const modelByValue = new Map(AVAILABLE_MODELS.map((m) => [m.value, m]));

export function getModelLabel(value: string): string {
  return getModelInfo(value).label;
}

export function getModelInfo(value: string): { label: string; isFree: boolean } {
  const trimmed = (value || "").trim();
  if (!trimmed) return { label: "", isFree: true };
  const model = modelByValue.get(trimmed);
  if (model) return { label: model.label, isFree: model.isFree };
  const lastPart = trimmed.split("/").pop();
  return { label: lastPart ?? trimmed, isFree: false };
}
