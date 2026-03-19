export const AVAILABLE_MODELS: { value: string; label: string; desc: string; isFree: boolean; pricePerInvoice: string | null }[] = [
  { value: "openrouter/free", label: "OpenRouter Free Router", desc: "Wählt automatisch aus kostenlosen Modellen", isFree: true, pricePerInvoice: null },
  { value: "openrouter/hunter-alpha", label: "Hunter Alpha", desc: "1T Parameter – Frontier", isFree: true, pricePerInvoice: null },
  { value: "openrouter/healer-alpha", label: "Healer Alpha", desc: "Omni-modal – Vision + Audio", isFree: true, pricePerInvoice: null },
  { value: "stepfun/step-3.5-flash:free", label: "Step 3.5 Flash", desc: "StepFun – Reasoning", isFree: true, pricePerInvoice: null },
  { value: "arcee-ai/trinity-large-preview:free", label: "Trinity Large Preview", desc: "Arcee – Frontier-Scale", isFree: true, pricePerInvoice: null },
  { value: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super", desc: "NVIDIA – 120B MoE", isFree: true, pricePerInvoice: null },
  { value: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B", desc: "Meta – multilingual", isFree: true, pricePerInvoice: null },
  { value: "nvidia/nemotron-nano-12b-v2-vl:free", label: "Nemotron Nano 12B VL", desc: "NVIDIA – Dokumente/Bilder", isFree: true, pricePerInvoice: null },
  { value: "qwen/qwen3-coder-480b-a35b-instruct:free", label: "Qwen3 Coder 480B", desc: "Alibaba – Code/Agentic", isFree: true, pricePerInvoice: null },
  { value: "z-ai/glm-4.5-air:free", label: "GLM 4.5 Air", desc: "Z.ai – Agentic", isFree: true, pricePerInvoice: null },
  { value: "mistralai/mistral-small-3.1-24b-instruct:free", label: "Mistral Small 3.1 24B", desc: "Mistral – multimodal", isFree: true, pricePerInvoice: null },
  { value: "nvidia/nemotron-3-nano-30b-a3b:free", label: "Nemotron 3 Nano 30B", desc: "NVIDIA – effizient", isFree: true, pricePerInvoice: null },
  { value: "google/gemma-3n-e2b-it:free", label: "Gemma 3n 2B", desc: "Google – klein & schnell", isFree: true, pricePerInvoice: null },
  { value: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku", desc: "Schnell & zuverlässig", isFree: false, pricePerInvoice: "~0.05€" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o Mini", desc: "OpenAI – ausgewogen", isFree: false, pricePerInvoice: "~0.05€" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", desc: "Google – schnell", isFree: false, pricePerInvoice: "~0.05€" },
  { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", desc: "Starke Qualität", isFree: false, pricePerInvoice: "~0.15€" },
  { value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", desc: "Anthropic – Top Sonnet", isFree: false, pricePerInvoice: "~0.15€" },
  { value: "openai/gpt-4o", label: "GPT-4o", desc: "OpenAI – Top-Qualität", isFree: false, pricePerInvoice: "~0.15€" },
  { value: "openai/gpt-4.1", label: "GPT-4.1", desc: "OpenAI – 1M Context, starkes Instruction Following", isFree: false, pricePerInvoice: "~0.15€" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", desc: "Google – beste Qualität", isFree: false, pricePerInvoice: "~0.15€" },
  { value: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6", desc: "Anthropic – stärkstes Modell", isFree: false, pricePerInvoice: "~0.40€" },
  { value: "openai/o1", label: "o1", desc: "OpenAI – Reasoning, Vision, komplexe Abwägungen", isFree: false, pricePerInvoice: "~0.40€" },
];

const modelByValue = new Map(AVAILABLE_MODELS.map((m) => [m.value, m]));

export function getModelLabel(value: string): string {
  return getModelInfo(value).label;
}

export function getModelInfo(value: string): { label: string; isFree: boolean; pricePerInvoice: string | null } {
  const trimmed = (value || "").trim();
  if (!trimmed) return { label: "", isFree: true, pricePerInvoice: null };
  const model = modelByValue.get(trimmed);
  if (model) return { label: model.label, isFree: model.isFree, pricePerInvoice: model.pricePerInvoice };
  const lastPart = trimmed.split("/").pop();
  return { label: lastPart ?? trimmed, isFree: false, pricePerInvoice: null };
}
