import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const HISTORY_KEY = "docbill_feedback_history";
const HISTORY_LIMIT = 10;
const EXPERT_THRESHOLD = 10;

/** Unter Limit bleiben (Server max. ~512 KB inkl. Metadaten/RL-Kontext). */
const MAX_RESPONSE_CONTENT_CHARS = 120_000;
const MAX_STRUCTURED_JSON_CHARS = 120_000;

export type FeedbackRating = 1 | -1;
export type InquiryReason = "A" | "B" | "C";

export type SendFeedbackResult = { ok: true } | { ok: false; error: string };

/** Optional Kontext für spätere Auswertung / RL — wird in Storage-JSON mitgeschrieben. */
export type RlFeedbackContext = {
  model?: string;
  engine?: string;
  user_messages?: { role: string; content: string }[];
  structured_snapshot?: unknown;
};

function clipResponseContent(s: string): string {
  if (s.length <= MAX_RESPONSE_CONTENT_CHARS) return s;
  return `${s.slice(0, MAX_RESPONSE_CONTENT_CHARS)}\n…[truncated]`;
}

function slimRlContextForPayload(ctx: RlFeedbackContext | null | undefined): RlFeedbackContext | null | undefined {
  if (!ctx) return ctx;
  const out: RlFeedbackContext = {
    ...(ctx.model != null ? { model: ctx.model } : {}),
    ...(ctx.engine != null ? { engine: ctx.engine } : {}),
    ...(ctx.user_messages != null ? { user_messages: ctx.user_messages } : {}),
    ...(ctx.structured_snapshot != null ? { structured_snapshot: ctx.structured_snapshot } : {}),
  };
  if (out.structured_snapshot) {
    try {
      const raw = JSON.stringify(out.structured_snapshot);
      if (raw.length > MAX_STRUCTURED_JSON_CHARS) {
        const snap = out.structured_snapshot as Record<string, unknown>;
        out.structured_snapshot = {
          _docbill_truncated: true,
          hasInvoice: "invoiceResult" in snap,
          hasService: "serviceBillingResult" in snap,
          hasEngine3: "engine3Result" in snap,
          hasFrage: "frageAnswer" in snap,
        };
      }
    } catch {
      delete out.structured_snapshot;
    }
  }
  return out;
}

async function parseFeedbackInvokeError(error: unknown): Promise<string> {
  const err = error as { name?: string; message?: string; context?: Response };
  if (err?.name === "FunctionsHttpError" && err.context instanceof Response) {
    try {
      const j = (await err.context.clone().json()) as {
        error?: string;
        details?: string;
        message?: string;
      };
      if (typeof j?.error === "string") {
        return j.details ? `${j.error}: ${j.details}` : j.error;
      }
    } catch {
      try {
        const t = (await err.context.clone().text()).slice(0, 400);
        if (t?.trim()) return t.trim();
      } catch {
        /* */
      }
    }
  }
  return (typeof err?.message === "string" && err.message) || "Unbekannter Fehler";
}

export function useFeedback() {
  const sendFeedback = useCallback(
    async (payload: {
      message_id: string;
      conversation_id: string;
      response_content: string;
      rating: FeedbackRating;
      metadata?: { decisions?: Record<string, string>; inquiry_reason?: InquiryReason | null };
      rl_context?: RlFeedbackContext | null;
    }): Promise<SendFeedbackResult> => {
      const body = {
        ...payload,
        response_content: clipResponseContent(payload.response_content),
        rl_context: slimRlContextForPayload(payload.rl_context ?? null),
        timestamp: new Date().toISOString(),
      };
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>("feedback", {
        body,
      });

      if (error) {
        console.error("Feedback failed:", error);
        const detail = await parseFeedbackInvokeError(error);
        // #region agent log
        let httpStatus: number | undefined;
        let serverPreview = "";
        if (
          error.name === "FunctionsHttpError" &&
          typeof error === "object" &&
          error !== null &&
          "context" in error &&
          error.context instanceof Response
        ) {
          httpStatus = error.context.status;
          try {
            serverPreview = (await error.context.clone().text()).slice(0, 500);
          } catch {
            serverPreview = "(body unreadable)";
          }
        }
        fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79522a" },
          body: JSON.stringify({
            sessionId: "79522a",
            runId: "storage-500",
            hypothesisId: "H8",
            location: "useFeedback.ts:sendFeedback",
            message: "feedback_invoke_error",
            data: {
              errName: error.name,
              errMessageLen: error.message.length,
              httpStatus,
              serverPreviewLen: serverPreview.length,
              serverPreview,
              isDev: import.meta.env.DEV,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        return { ok: false, error: detail };
      }

      if (!data || data.ok !== true) {
        console.error("Feedback unexpected response:", data);
        const msg =
          data && typeof (data as { error?: string }).error === "string"
            ? (data as { error: string }).error
            : "Unerwartete Antwort der Feedback-Funktion.";
        // #region agent log
        fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79522a" },
          body: JSON.stringify({
            sessionId: "79522a",
            runId: "invoke-fix",
            hypothesisId: "H4",
            location: "useFeedback.ts:sendFeedback",
            message: "feedback_invoke_bad_body",
            data: { hasData: data != null, ok: data && "ok" in data ? data.ok : null },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        return { ok: false, error: msg };
      }

      // #region agent log
      fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79522a" },
        body: JSON.stringify({
          sessionId: "79522a",
          runId: "post-fix",
          hypothesisId: "H4",
          location: "useFeedback.ts:sendFeedback",
          message: "feedback_http_ok",
          data: { via: "invoke" },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion

      // Update localStorage for saturation logic
      const history = getFeedbackHistory();
      history.push(payload.rating);
      if (history.length > HISTORY_LIMIT) history.shift();
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));

      return { ok: true };
    },
    []
  );

  const isExpertMode = useCallback((): boolean => {
    const history = getFeedbackHistory();
    if (history.length < EXPERT_THRESHOLD) return false;
    return history.every((r) => r === 1);
  }, []);

  return { sendFeedback, isExpertMode };
}

function getFeedbackHistory(): number[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(-HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}
