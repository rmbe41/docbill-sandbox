import type { InvoiceResultData } from "@/components/InvoiceResult";
import type { ServiceBillingResultData } from "@/components/ServiceBillingResult";
import type { Engine3ResultData } from "@/lib/engine3Result";
import {
  consumeGoaeChatSseStream,
  type PipelineProgressPayload,
  type SseAccumState,
} from "@/lib/goaeChatSse";
import type { GuidedWorkflowKind } from "@/lib/guidedWorkflow";

const CHAT_URL = import.meta.env.DEV
  ? `/api/supabase/functions/v1/goae-chat`
  : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/goae-chat`;

export type ApiChatMessage = { role: string; content: string };

export type ExecuteGoaeChatParams = {
  supabaseKey: string;
  apiMessages: ApiChatMessage[];
  filePayloads?: { name: string; type: string; data: string }[];
  model: string;
  engine_type: string;
  extra_rules: string;
  /** Kürzere strukturierte Direktmodus-Antworten (Server + UI). */
  kurzantworten?: boolean;
  /** GOÄ-Katalog, lokaler Wissensblock und Admin-RAG in LLM-Prompts (Default an). */
  kontext_wissen?: boolean;
  lastInvoiceResult?: InvoiceResultData;
  lastServiceResult?: ServiceBillingResultData;
  lastEngine3Result?: Engine3ResultData;
  signal: AbortSignal;
  onProgress: (p: PipelineProgressPayload | null) => void;
  onStreamState: (state: SseAccumState) => void;
  onFreeModelsExhausted?: (details: string | null) => void;
  guidedWorkflow?: GuidedWorkflowKind;
  guidedPhase?: "collect";
  /** Partition der Datei-Indizes für Engine-3-Rechnungsprüfung (mehrere PDFs). */
  engine3CaseGroups?: number[][];
};

export type ExecuteGoaeChatHttpError = {
  kind: "http";
  status: number;
  body: { error?: string; code?: string; details?: string };
};

export async function executeGoaeChatRequest(
  params: ExecuteGoaeChatParams,
): Promise<{ ok: true; state: SseAccumState; analysisTimeSeconds: number } | { ok: false; error: ExecuteGoaeChatHttpError | { kind: "network"; message: string } }> {
  const startTime = Date.now();
  const state: SseAccumState = {
    assistantContent: "",
    invoiceData: undefined,
    serviceBillingData: undefined,
    engine3Data: undefined,
  };

  let resp: Response;
  try {
    resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.supabaseKey}`,
      },
      body: JSON.stringify({
        messages: params.apiMessages,
        files: params.filePayloads && params.filePayloads.length > 0 ? params.filePayloads : undefined,
        model: params.model,
        engine_type: params.engine_type,
        extra_rules: params.extra_rules,
        ...(params.kurzantworten === true ? { kurzantworten: true } : {}),
        ...(params.kontext_wissen === false ? { kontext_wissen: false } : {}),
        ...(params.lastInvoiceResult && {
          last_invoice_result: { pruefung: params.lastInvoiceResult },
        }),
        ...(params.lastServiceResult && {
          last_service_result: {
            vorschlaege: params.lastServiceResult.vorschlaege,
            optimierungen: params.lastServiceResult.optimierungen,
            klinischerKontext: params.lastServiceResult.klinischerKontext,
            fachgebiet: params.lastServiceResult.fachgebiet,
          },
        }),
        ...(params.lastEngine3Result && {
          last_engine3_result: {
            modus: params.lastEngine3Result.modus,
            klinischerKontext: params.lastEngine3Result.klinischerKontext,
            positionen: params.lastEngine3Result.positionen.map((p) => ({ ziffer: p.ziffer })),
            optimierungen: params.lastEngine3Result.optimierungen?.map((p) => ({ ziffer: p.ziffer })),
          },
        }),
        ...(params.guidedWorkflow && params.guidedPhase
          ? { guided_workflow: params.guidedWorkflow, guided_phase: params.guidedPhase }
          : {}),
        ...(params.engine3CaseGroups?.length ? { engine3_case_groups: params.engine3CaseGroups } : {}),
      }),
      signal: params.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { kind: "network", message: msg } };
  }

  if (!resp.ok) {
    let errBody: { error?: string; code?: string; details?: string } = {};
    try {
      errBody = await resp.json();
    } catch {
      /* ignore */
    }
    return { ok: false, error: { kind: "http", status: resp.status, body: errBody } };
  }

  if (!resp.body) {
    return { ok: false, error: { kind: "network", message: "Stream failed" } };
  }

  const reader = resp.body.getReader();
  // #region agent log
  fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a85cc5" },
    body: JSON.stringify({
      sessionId: "a85cc5",
      location: "executeGoaeChatRequest.ts:startConsume",
      message: "SSE consume start",
      data: { engine_type: params.engine_type, fileCount: params.filePayloads?.length ?? 0 },
      timestamp: Date.now(),
      hypothesisId: "H3",
    }),
  }).catch(() => {});
  // #endregion
  await consumeGoaeChatSseStream(reader, {
    state,
    onProgress: params.onProgress,
    onDelta: () => params.onStreamState({ ...state }),
    onFreeModelsExhausted: params.onFreeModelsExhausted,
  });

  const analysisTimeSeconds = (Date.now() - startTime) / 1000;

  // #region agent log
  fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a85cc5" },
    body: JSON.stringify({
      sessionId: "a85cc5",
      runId: "post-fix",
      hypothesisId: "H4",
      location: "executeGoaeChatRequest.ts:afterConsume",
      message: "SSE accumulate final",
      data: {
        engine_type: params.engine_type,
        hadEngine3: !!state.engine3Data,
        hadInvoice: !!state.invoiceData,
        hadServiceBilling: !!state.serviceBillingData,
        assistantLen: state.assistantContent.length,
        hasEngine3Err: /\*\*Engine-3-Fehler:\*\*/.test(state.assistantContent),
        hasDeliverableText: state.assistantContent.trim().length > 0,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  return { ok: true, state, analysisTimeSeconds };
}
