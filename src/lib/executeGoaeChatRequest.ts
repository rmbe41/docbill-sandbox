import type { InvoiceResultData } from "@/components/InvoiceResult";
import type { ServiceBillingResultData } from "@/components/ServiceBillingResult";
import {
  consumeGoaeChatSseStream,
  type PipelineProgressPayload,
  type SseAccumState,
} from "@/lib/goaeChatSse";

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
  lastInvoiceResult?: InvoiceResultData;
  lastServiceResult?: ServiceBillingResultData;
  signal: AbortSignal;
  onProgress: (p: PipelineProgressPayload | null) => void;
  onStreamState: (state: SseAccumState) => void;
  onFreeModelsExhausted?: (details: string | null) => void;
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
  await consumeGoaeChatSseStream(reader, {
    state,
    onProgress: params.onProgress,
    onDelta: () => params.onStreamState({ ...state }),
    onFreeModelsExhausted: params.onFreeModelsExhausted,
  });

  const analysisTimeSeconds = (Date.now() - startTime) / 1000;

  // #region agent log
  fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "c81fbe" },
    body: JSON.stringify({
      sessionId: "c81fbe",
      hypothesisId: "H1",
      location: "executeGoaeChatRequest.ts:success",
      message: "client observed response shape",
      data: {
        hadServiceBilling: !!state.serviceBillingData,
        hadInvoice: !!state.invoiceData,
        hasFiles: !!(params.filePayloads && params.filePayloads.length),
        assistantLen: state.assistantContent.length,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  return { ok: true, state, analysisTimeSeconds };
}
