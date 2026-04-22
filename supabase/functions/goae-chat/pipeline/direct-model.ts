/**
 * Direktmodell: ein einziger Streaming-LLM-Aufruf mit dem vom Nutzer gewählten Modell.
 * Keine Intent-Klassifikation, keine GOÄ-/RAG-Blöcke, keine Parser- oder Pipeline-Zwischenschritte.
 *
 * Direktmodell 2.0 (lokal): gleicher Ablauf, aber mit selektivem GOÄ-Katalog/Regeln und Admin-RAG (KI-Kontext).
 */

import { buildChatSelectiveCatalogMarkdown } from "../goae-catalog-json.ts";
import { GOAE_PARAGRAPHEN } from "../goae-paragraphen.ts";
import {
  GOAE_ABSCHNITTE,
  GOAE_ANALOGE_BEWERTUNG,
  GOAE_BEGRUENDUNGEN,
  GOAE_SONDERBEREICHE_KOMPAKT,
} from "../goae-regeln.ts";
import { DIRECT_SHORT_JSON_OUTPUT_RULES } from "../frage-answer-format.ts";
import type { FilePayload } from "./types.ts";
import { getReasoningConfigForStream, isFreeModel, resolveModel } from "../model-resolver.ts";
import { getPseudonymRequestContext } from "../privacy/pseudonym-request-context.ts";
import { pseudonymizeOpenRouterMessages } from "../privacy/pseudonym-openrouter-messages.ts";
import { loadPseudonymMap } from "../privacy/pseudonym-redis.ts";
import { reidentifyText } from "../privacy/pseudonymize-bridge.ts";

const DIRECT_SYSTEM_CORE = `Du antwortest als Assistent. In diesem **Direktmodell** werden der DocBill-GOÄ-Katalog, RAG aus Admin-Wissensdateien und mehrstufige Abrechnungs-Pipelines **nicht** eingebunden – es gilt nur diese Unterhaltung (und ggf. Anhänge) sowie das gewählte Sprachmodell.

Antworte **auf Deutsch**, sofern der Nutzer nicht ausdrücklich eine andere Sprache wünscht.`;

const DIRECT_LOCAL_SYSTEM_CORE = `Du antwortest als Assistent im **Direktmodell 2.0 (lokal)**.

Wie beim klassischen Direktmodell läuft **ein** Streaming-Aufruf mit dem gewählten Sprachmodell: **keine** Intent-Klassifikation und **keine** mehrstufige Abrechnungs-Pipeline.

**Eingebunden** sind:
- **DEIN GOÄ-WISSEN** – DocBill-GOÄ-Katalog (selektiv zum Chat) sowie die mitgelieferten GOÄ-Paragraphen- und Regeltexte,
- **ADMIN-KONTEXT** – relevante Ausschnitte aus den **KI-Kontext**-Wissensdateien (falls im Systemprompt vorhanden).

Verpflichtend:
- Bevorzuge **konkrete Fakten** aus diesen Blöcken gegenüber allgemeinem Modellwissen. Bei Widerspruch gilt der **mitgelieferte Kontext**.
- Nutzt du den ADMIN-KONTEXT, nenne die **Quelle** (Dateiname wie im Kontext angegeben).
- **Keine** erfundenen GOÄ-Ziffern oder Beträge: nur was im DEIN GOÄ-WISSEN- oder Admin-Text steht, oder klar als allgemeine Orientierung ohne konkrete Ziffer kennzeichnen.

Antworte **auf Deutsch**, sofern der Nutzer nicht ausdrücklich eine andere Sprache wünscht.`;

/** Wenn JSON-Kurzantwort fehlschlägt: strukturiertes Markdown-Streaming mit Zusammenfassung zuerst. */
const DIRECT_SHORT_MARKDOWN_STREAM_APPENDIX = `

## Kurzantworten (Markdown, verbindlich)

- **Eine** Überschrift \`### Antwort\`, darunter **1–2** kurze Absätze und optional **höchstens 5** Bullets (\`- \`).
- Kein Gruß, keine Meta-Einleitung. Keine weiteren \`###\`.`;

function buildDirectSystemPrompt(extraRules?: string): string {
  let s = DIRECT_SYSTEM_CORE;
  if (extraRules?.trim()) {
    s += `\n\n## Zusätzliche Regeln (vom Administrator/Nutzer):\n${extraRules.trim()}`;
  }
  return s;
}

function buildDirectLocalGoaeKnowledgeBlock(
  messages: { role: string; content: unknown }[],
  catalogMaxLines: number,
): string {
  const goaeKatalogMarkdown = buildChatSelectiveCatalogMarkdown(messages, catalogMaxLines);
  return `DEIN GOÄ-WISSEN:

${GOAE_PARAGRAPHEN}

${GOAE_ABSCHNITTE}

${GOAE_SONDERBEREICHE_KOMPAKT}

${goaeKatalogMarkdown}

${GOAE_ANALOGE_BEWERTUNG}

${GOAE_BEGRUENDUNGEN}`;
}

function buildDirectLocalSystemPrompt(
  messages: { role: string; content: string }[],
  adminContext: string,
  extraRules?: string,
  catalogMaxLines = 100,
): string {
  const ambiguous: { role: string; content: unknown }[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const knowledge = buildDirectLocalGoaeKnowledgeBlock(ambiguous, catalogMaxLines);
  const adminTrim = adminContext.trim();
  let systemContent = DIRECT_LOCAL_SYSTEM_CORE;
  if (adminTrim) {
    systemContent += `\n\n${adminTrim}`;
  }
  systemContent += `\n\n${knowledge}`;
  if (extraRules?.trim()) {
    systemContent += `\n\n## Zusätzliche Regeln (vom Administrator/Nutzer):\n${extraRules.trim()}`;
  }
  return systemContent;
}

/** Systemprompt für JSON-Kurzantworten (klassisches Direktmodell, ohne GOÄ-Block). */
export function buildDirectShortJsonSystemPrompt(extraRules?: string): string {
  let s = `${DIRECT_SYSTEM_CORE}\n\n${DIRECT_SHORT_JSON_OUTPUT_RULES}`;
  if (extraRules?.trim()) {
    s += `\n\n## Zusätzliche Regeln (vom Administrator/Nutzer):\n${extraRules.trim()}`;
  }
  return s;
}

/** Systemprompt für JSON-Kurzantworten (Direkt lokal mit GOÄ + Admin). */
export function buildDirectLocalShortJsonSystemPrompt(
  messages: { role: string; content: string }[],
  adminContext: string,
  extraRules?: string,
  catalogMaxLines = 100,
): string {
  return `${buildDirectLocalSystemPrompt(messages, adminContext, extraRules, catalogMaxLines)}\n\n${DIRECT_SHORT_JSON_OUTPUT_RULES}`;
}

function filePartsFromPayloads(files: FilePayload[]): unknown[] {
  const parts: unknown[] = [];
  for (const file of files) {
    const mimeType = file.type || "application/octet-stream";
    if (mimeType === "application/pdf") {
      parts.push({
        type: "file",
        file: {
          filename: file.name,
          file_data: `data:application/pdf;base64,${file.data}`,
        },
      });
    } else {
      parts.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${file.data}` },
      });
    }
  }
  return parts;
}

function buildMessagesForDirect(
  messages: { role: string; content: string }[],
  files: FilePayload[] | undefined,
): unknown[] {
  const list = messages ?? [];
  const out: unknown[] = list.map((m) => ({ role: m.role, content: m.content }));

  const hasFiles = files && files.length > 0;
  if (!hasFiles) return out;

  const last = list[list.length - 1];
  if (last?.role === "user") {
    out.pop();
    const text = String(last.content ?? "");
    const contentParts: unknown[] = [];
    if (text.trim()) contentParts.push({ type: "text", text });
    contentParts.push(...filePartsFromPayloads(files!));
    if (contentParts.length === 0) {
      contentParts.push({ type: "text", text: "Siehe angehängte Dateien." });
    }
    out.push({ role: "user", content: contentParts });
  } else {
    out.push({
      role: "user",
      content: [{ type: "text", text: "Siehe angehängte Dateien." }, ...filePartsFromPayloads(files!)],
    });
  }

  return out;
}

async function jsonErrorFromOpenRouter(
  response: Response,
  opts: { requestedModelId: string; resolvedModel: string },
): Promise<Response> {
  const t = await response.text();
  console.error("[direct-model] OpenRouter error:", response.status, t);
  let errMsg = "AI-Gateway Fehler";
  try {
    const parsed = JSON.parse(t) as { error?: unknown; detail?: unknown; message?: unknown };
    const e = parsed?.error;
    if (typeof e === "object" && e !== null && "message" in e && typeof (e as { message?: string }).message === "string") {
      errMsg = (e as { message: string }).message;
    } else if (typeof e === "string") errMsg = e;
    else if (parsed?.detail != null) errMsg = String(parsed.detail);
    else if (parsed?.message != null) errMsg = String(parsed.message);
  } catch {
    /* use fallback */
  }
  if (errMsg === "AI-Gateway Fehler") {
    const hints: Record<number, string> = {
      401: "OpenRouter API-Key ungültig. Prüfen Sie OPENROUTER_API_KEY in Supabase Secrets.",
      403: "Anfrage von Moderation blockiert.",
      408: "Zeitüberschreitung. Bitte erneut versuchen.",
      502: "Modell-Anbieter vorübergehend nicht erreichbar.",
      503: "Kein Modell-Anbieter verfügbar. Anderes Modell wählen.",
    };
    errMsg = hints[response.status] ?? `OpenRouter Fehler (${response.status}).`;
  }
  const status = response.status >= 400 ? response.status : 500;
  const payload: Record<string, unknown> = { error: errMsg };
  if (isFreeModel(opts.requestedModelId)) {
    payload.code = "FREE_MODELS_EXHAUSTED";
    payload.details = `Modell: ${opts.resolvedModel}. HTTP-Status: ${response.status}.`;
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function openAiStyleSseFromText(text: string): Response {
  const encoder = new TextEncoder();
  const chunkSize = 120;
  const stream = new ReadableStream({
    start(controller) {
      for (let j = 0; j < text.length; j += chunkSize) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: text.slice(j, j + chunkSize) } }],
            })}\n\n`,
          ),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

export async function completionTextFromJsonResponse(response: Response): Promise<string> {
  const data = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
  const c = data.choices?.[0]?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .filter((p: { type?: string }) => p?.type === "text")
      .map((p: { text?: string }) => p.text ?? "")
      .join("\n");
  }
  return "";
}

export async function runDirectModelStream(
  input: {
    messages: { role: string; content: string }[];
    files?: FilePayload[];
    model: string;
    extraRules?: string;
    /** Hängt Kurzformat-Anweisung an (ohne JSON). */
    preferShortMarkdown?: boolean;
    maxTokens?: number;
  },
  apiKey: string,
): Promise<Response> {
  const resolved = resolveModel(input.model);
  let systemPrompt = buildDirectSystemPrompt(input.extraRules);
  if (input.preferShortMarkdown) {
    systemPrompt += DIRECT_SHORT_MARKDOWN_STREAM_APPENDIX;
  }
  const tail = buildMessagesForDirect(input.messages, input.files);
  const apiMessages: unknown[] = [{ role: "system", content: systemPrompt }, ...tail];
  const ctx = getPseudonymRequestContext();
  const messagesForApi = ctx
    ? await pseudonymizeOpenRouterMessages([...apiMessages], ctx)
    : apiMessages;

  const reasoningConfig = getReasoningConfigForStream(input.model);

  const body: Record<string, unknown> = {
    model: resolved,
    messages: messagesForApi,
    stream: ctx ? false : true,
  };
  if (reasoningConfig) body.reasoning = reasoningConfig;
  if (typeof input.maxTokens === "number" && input.maxTokens > 0) {
    body.max_tokens = input.maxTokens;
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.ok && (response.body || ctx)) {
    if (ctx) {
      let text = await completionTextFromJsonResponse(response);
      const map = await loadPseudonymMap(ctx.sessionId);
      if (map?.mappings.length) text = reidentifyText(text, map);
      return openAiStyleSseFromText(text);
    }
    return new Response(response.body, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  if (response.status === 429) {
    return new Response(
      JSON.stringify({ error: "Rate Limit erreicht. Bitte warten Sie einen Moment." }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }
  if (response.status === 402) {
    return new Response(
      JSON.stringify({ error: "Credits erschöpft. Bitte laden Sie Credits auf." }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    );
  }

  return jsonErrorFromOpenRouter(response, { requestedModelId: input.model, resolvedModel: resolved });
}

export async function runDirectLocalModelStream(
  input: {
    messages: { role: string; content: string }[];
    files?: FilePayload[];
    model: string;
    extraRules?: string;
    adminContext: string;
    catalogMaxLines?: number;
    preferShortMarkdown?: boolean;
    maxTokens?: number;
  },
  apiKey: string,
): Promise<Response> {
  const resolved = resolveModel(input.model);
  let systemPrompt = buildDirectLocalSystemPrompt(
    input.messages,
    input.adminContext,
    input.extraRules,
    input.catalogMaxLines ?? 100,
  );
  if (input.preferShortMarkdown) {
    systemPrompt += DIRECT_SHORT_MARKDOWN_STREAM_APPENDIX;
  }
  const tail = buildMessagesForDirect(input.messages, input.files);
  const apiMessages: unknown[] = [{ role: "system", content: systemPrompt }, ...tail];
  const ctx = getPseudonymRequestContext();
  const messagesForApi = ctx
    ? await pseudonymizeOpenRouterMessages([...apiMessages], ctx)
    : apiMessages;

  const reasoningConfig = getReasoningConfigForStream(input.model);

  const body: Record<string, unknown> = {
    model: resolved,
    messages: messagesForApi,
    stream: ctx ? false : true,
  };
  if (reasoningConfig) body.reasoning = reasoningConfig;
  if (typeof input.maxTokens === "number" && input.maxTokens > 0) {
    body.max_tokens = input.maxTokens;
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.ok && (response.body || ctx)) {
    if (ctx) {
      let text = await completionTextFromJsonResponse(response);
      const map = await loadPseudonymMap(ctx.sessionId);
      if (map?.mappings.length) text = reidentifyText(text, map);
      return openAiStyleSseFromText(text);
    }
    return new Response(response.body, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  if (response.status === 429) {
    return new Response(
      JSON.stringify({ error: "Rate Limit erreicht. Bitte warten Sie einen Moment." }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }
  if (response.status === 402) {
    return new Response(
      JSON.stringify({ error: "Credits erschöpft. Bitte laden Sie Credits auf." }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    );
  }

  return jsonErrorFromOpenRouter(response, { requestedModelId: input.model, resolvedModel: resolved });
}
