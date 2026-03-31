/**
 * Direktmodell: ein einziger Streaming-LLM-Aufruf mit dem vom Nutzer gewählten Modell.
 * Keine Intent-Klassifikation, keine GOÄ-/RAG-Blöcke, keine Parser- oder Pipeline-Zwischenschritte.
 */

import type { FilePayload } from "./types.ts";
import { getReasoningConfigForStream, isFreeModel, resolveModel } from "../model-resolver.ts";

const DIRECT_SYSTEM_CORE = `Du antwortest als Assistent. In diesem **Direktmodell** werden der DocBill-GOÄ-Katalog, RAG aus Admin-Wissensdateien und mehrstufige Abrechnungs-Pipelines **nicht** eingebunden – es gilt nur diese Unterhaltung (und ggf. Anhänge) sowie das gewählte Sprachmodell.

Antworte **auf Deutsch**, sofern der Nutzer nicht ausdrücklich eine andere Sprache wünscht.`;

function buildDirectSystemPrompt(extraRules?: string): string {
  let s = DIRECT_SYSTEM_CORE;
  if (extraRules?.trim()) {
    s += `\n\n## Zusätzliche Regeln (vom Administrator/Nutzer):\n${extraRules.trim()}`;
  }
  return s;
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

export async function runDirectModelStream(
  input: {
    messages: { role: string; content: string }[];
    files?: FilePayload[];
    model: string;
    extraRules?: string;
  },
  apiKey: string,
): Promise<Response> {
  const resolved = resolveModel(input.model);
  const systemPrompt = buildDirectSystemPrompt(input.extraRules);
  const tail = buildMessagesForDirect(input.messages, input.files);
  const apiMessages: unknown[] = [{ role: "system", content: systemPrompt }, ...tail];

  const reasoningConfig = getReasoningConfigForStream(input.model);

  const body: Record<string, unknown> = {
    model: resolved,
    messages: apiMessages,
    stream: true,
  };
  if (reasoningConfig) body.reasoning = reasoningConfig;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.ok && response.body) {
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
