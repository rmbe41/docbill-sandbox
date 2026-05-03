/**
 * Ruft dieselbe Service-Billing-Pipeline auf wie goae-chat (OpenRouter → NLP → Mapping → Regelengine)
 * für jede Sandbox-Vorlage auf und schreibt `src/data/sandbox/sandbox-engine-billing.generated.json`.
 *
 * Ausführung (Repo-Root):
 *   export OPENROUTER_API_KEY="sk-or-v1-…"
 *   npm run sandbox:engine-billing
 *
 * Optional: SANDBOX_ENGINE_MODEL (Standard: openrouter/free)
 * Optional: Nur eine Vorlage: --only=7  (Index 0…14)
 */
import type { SandboxEngineBillingArtifactFile } from "@/lib/sandbox/sandboxEngineBilling.ts";
import type { SandboxEngineBillingPosition } from "@/lib/sandbox/sandboxEngineBilling.ts";
import { SANDBOX_BILLING_TEMPLATES } from "@/lib/sandbox/billingCases.ts";
import type { ServiceBillingPosition } from "#/pipeline/service-billing-orchestrator.ts";
import { runServiceBillingPipeline } from "#/pipeline/service-billing-orchestrator.ts";

type SandboxTemplateRow = (typeof SANDBOX_BILLING_TEMPLATES)[number];

function buildClinicalUserMessage(t: SandboxTemplateRow): string {
  return `Behandlungsart: ${t.encounter_type}

Anamnese:
${t.anamnesis}

Befund:
${t.findings}

Diagnose:
${t.diagnosis_text}

Therapie:
${t.therapy}`;
}

function stripBillingPosition(p: ServiceBillingPosition): SandboxEngineBillingPosition {
  const o: SandboxEngineBillingPosition = {
    ziffer: p.ziffer,
    bezeichnung: p.bezeichnung,
    faktor: p.faktor,
    betrag: p.betrag,
  };
  if (p.begruendung?.trim()) o.begruendung = p.begruendung.trim();
  return o;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
if (!apiKey) {
  console.error("[sandbox:engine-billing] OPENROUTER_API_KEY fehlt.");
  Deno.exit(1);
}

const model = Deno.env.get("SANDBOX_ENGINE_MODEL")?.trim() || "openrouter/free";
const onlyArg = Deno.args.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const onlyIdx =
  onlyArg != null && onlyArg !== "" && Number.isFinite(Number(onlyArg)) ? Number(onlyArg) : null;

const n = SANDBOX_BILLING_TEMPLATES.length;
const indices: number[] =
  onlyIdx !== null ? [onlyIdx].filter((i) => i >= 0 && i < n) : Array.from({ length: n }, (_, i) => i);

if (onlyIdx !== null && indices.length === 0) {
  console.error(`[sandbox:engine-billing] --only=${onlyArg} liegt außerhalb 0…${n - 1}.`);
  Deno.exit(1);
}

const out: SandboxEngineBillingArtifactFile = {
  useEngine: true,
  generatedAt: new Date().toISOString(),
  model,
  byTemplateIndex: Array.from({ length: n }, () => ({})),
};

console.log(`[sandbox:engine-billing] ${indices.length} Vorlage(n), Modell ${model}`);

for (let ix = 0; ix < indices.length; ix++) {
  const i = indices[ix]!;
  const t = SANDBOX_BILLING_TEMPLATES[i]!;
  const userMessage = buildClinicalUserMessage(t);
  console.log(`[sandbox:engine-billing] Vorlage ${i + 1}/${n} (${t.encounter_type}) …`);

  const ebmInput = {
    userMessage,
    model,
    regelwerk: "EBM" as const,
    kontextWissenEnabled: false,
  };
  const goaeInput = {
    userMessage,
    model,
    regelwerk: "GOAE" as const,
    kontextWissenEnabled: false,
  };

  try {
    const ebmResult = await runServiceBillingPipeline(ebmInput, apiKey);
    await sleep(400);
    const goaeResult = await runServiceBillingPipeline(goaeInput, apiKey);
    out.byTemplateIndex![i] = {
      ebmVorschlaege: ebmResult.vorschlaege.map(stripBillingPosition),
      goaeVorschlaege: goaeResult.vorschlaege.map(stripBillingPosition),
    };
    console.log(
      `[sandbox:engine-billing]   → EBM ${ebmResult.vorschlaege.length}, GOÄ ${goaeResult.vorschlaege.length} Hauptzeilen`,
    );
  } catch (e) {
    console.error(`[sandbox:engine-billing] Fehler Vorlage ${i}:`, e);
    Deno.exit(1);
  }
  await sleep(600);
}

const dst = "src/data/sandbox/sandbox-engine-billing.generated.json";
await Deno.writeTextFile(dst, JSON.stringify(out, null, 2) + "\n");
console.log(`[sandbox:engine-billing] geschrieben: ${dst}`);
