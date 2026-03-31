import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage } from "@/components/ChatBubble";
import { dbRowToChatMessage } from "@/lib/dbMessageToChatMessage";
import { fileToBase64 } from "@/lib/fileToBase64";
import { executeGoaeChatRequest } from "@/lib/executeGoaeChatRequest";
import {
  buildAssistantStructuredContent,
  buildUserStructuredContent,
  parseMessageStructured,
  type MessageStructuredContentV1,
} from "@/lib/messageStructuredContent";
import { frageAnswerToMarkdown } from "@/lib/frageAnswerStructured";
import {
  assistantContentHasSseError,
  sseAccumStateHasDeliverable,
  sseErrorSummaryFromAssistantContent,
} from "@/lib/goaeChatSse";
import {
  buildConversationTitle,
  conversationListTitleDisplay,
} from "@/lib/conversationTitle";
import type { GuidedWorkflowKind } from "@/lib/guidedWorkflow";
import type { User } from "@supabase/supabase-js";
import type { Json } from "@/integrations/supabase/types";
import type { AppToastFn } from "@/hooks/use-toast";

/**
 * Phase 3 (Cloud / server worker): `background_jobs` rows can be claimed by an Edge Function
 * or queue worker that invokes the same pipeline as the client. Schema + client queue are the extension point.
 */

export const MAX_CONCURRENT_BACKGROUND_JOBS = 2;

export type BackgroundJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type BackgroundJobPayload = {
  fileNames?: string[];
  assistantPreview?: string;
  guidedWorkflow?: GuidedWorkflowKind;
  guidedPhase?: "collect";
};

export type BackgroundJobRow = {
  id: string;
  user_id: string;
  conversation_id: string;
  status: BackgroundJobStatus;
  sort_order: number;
  payload: BackgroundJobPayload;
  error: string | null;
  progress_label: string | null;
  progress_step: number | null;
  progress_total: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type ConversationRunInfo = {
  isRunning: boolean;
  pipelineStep: { step: number; totalSteps: number; label: string } | null;
  analysisStartTime: number | null;
};

type TaskSpec = {
  content: string;
  files?: File[];
  guided?: { workflow: GuidedWorkflowKind; phase: "collect" };
};

function buildTaskList(content: string, files?: File[]): TaskSpec[] {
  if (!files?.length) return [{ content, files: undefined }];
  /** One task with all files → one conversation / one job; executeGoaeChatRequest accepts multiple filePayloads. */
  return [{ content, files }];
}

function mergePayload(
  prev: BackgroundJobPayload,
  patch: Partial<BackgroundJobPayload>,
): BackgroundJobPayload {
  return { ...prev, ...patch };
}

type UseBackgroundJobQueueParams = {
  user: User | null;
  toast: AppToastFn;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  createConversation: (title: string) => Promise<string | null>;
  saveMessage: (
    conversationId: string,
    role: "user" | "assistant",
    content: string,
    structured?: MessageStructuredContentV1 | null,
  ) => Promise<string | null>;
  loadMessages: (conversationId: string) => Promise<
    { id: string; role: string; content: string; structured_content?: unknown }[]
  >;
  updateSourceFilename: (id: string, filename: string) => Promise<void>;
  updateTitle: (id: string, title: string) => Promise<void>;
  fetchConversations: () => Promise<void>;
  userSettings: {
    engine_type: string | null;
    custom_rules: string | null;
    kurzantworten?: boolean;
    kontext_wissen?: boolean;
  };
  globalSettings: { default_engine: string; default_rules: string };
  effectiveModel: string;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onFreeModelsExhausted: (details: string | null) => void;
};

export function useBackgroundJobQueue({
  user,
  toast,
  activeConversationId,
  setActiveConversationId,
  createConversation,
  saveMessage,
  loadMessages,
  updateSourceFilename,
  updateTitle,
  fetchConversations,
  userSettings,
  globalSettings,
  effectiveModel,
  setMessages,
  onFreeModelsExhausted,
}: UseBackgroundJobQueueParams) {
  const [jobs, setJobs] = useState<BackgroundJobRow[]>([]);
  const [runStates, setRunStates] = useState<Record<string, ConversationRunInfo>>({});

  const pendingFilePayloadsRef = useRef(
    new Map<string, { name: string; type: string; data: string }[]>(),
  );
  const abortByJobIdRef = useRef(new Map<string, AbortController>());
  const runningJobIdsRef = useRef(new Set<string>());
  const drainMutexRef = useRef(false);
  /** Partial assistant message while a job streams — survives tab switches between conversations. */
  const liveAssistantByConvRef = useRef(
    new Map<
      string,
      Pick<
        ChatMessage,
        | "content"
        | "invoiceResult"
        | "serviceBillingResult"
        | "engine3Result"
        | "analysisTimeSeconds"
        | "frageAnswer"
      >
    >(),
  );

  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;

  const fetchJobs = useCallback(async () => {
    if (!user) {
      setJobs([]);
      return;
    }
    const { data, error } = await supabase
      .from("background_jobs")
      .select("*")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      console.error("fetchJobs", error);
      return;
    }
    setJobs((data as BackgroundJobRow[]) ?? []);
  }, [user]);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      await supabase
        .from("background_jobs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error: "Analyse unterbrochen (Seite neu geladen oder Tab geschlossen).",
          progress_label: null,
          progress_step: null,
          progress_total: null,
        })
        .eq("user_id", user.id)
        .eq("status", "running");
      await fetchJobs();
    })();
  }, [user, fetchJobs]);

  const patchRunState = useCallback((conversationId: string, patch: Partial<ConversationRunInfo>) => {
    setRunStates((prev) => {
      const cur = prev[conversationId] ?? {
        isRunning: false,
        pipelineStep: null,
        analysisStartTime: null,
      };
      return { ...prev, [conversationId]: { ...cur, ...patch } };
    });
  }, []);

  const clearRunState = useCallback((conversationId: string) => {
    setRunStates((prev) => {
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  }, []);

  const updateJobRow = useCallback(
    async (jobId: string, patch: Partial<BackgroundJobRow>) => {
      const { error } = await supabase.from("background_jobs").update(patch).eq("id", jobId);
      if (error) console.error("updateJobRow", error);
      await fetchJobs();
    },
    [fetchJobs],
  );

  const updateJobProgressDb = useCallback(async (jobId: string, patch: Partial<BackgroundJobRow>) => {
    const { error } = await supabase.from("background_jobs").update(patch).eq("id", jobId);
    if (error) console.error("updateJobProgressDb", error);
  }, []);

  const claimNextQueuedJob = useCallback(async (): Promise<BackgroundJobRow | null> => {
    if (!user) return null;
    const { data: row, error: selErr } = await supabase
      .from("background_jobs")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "queued")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (selErr || !row) return null;

    const { data: updated, error: updErr } = await supabase
      .from("background_jobs")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "queued")
      .select()
      .maybeSingle();

    if (updErr || !updated) return null;
    return updated as BackgroundJobRow;
  }, [user]);

  const executeJob = useCallback(
    async (job: BackgroundJobRow) => {
      const conversationId = job.conversation_id;
      const payload = job.payload ?? {};
      const fileNames = payload.fileNames ?? [];
      const needsFiles = fileNames.length > 0;
      const filePayloads = pendingFilePayloadsRef.current.get(job.id);
      if (needsFiles && (!filePayloads || filePayloads.length === 0)) {
        await updateJobRow(job.id, {
          status: "failed",
          finished_at: new Date().toISOString(),
          error: "Dateien nicht mehr verfügbar. Bitte erneut hochladen.",
          progress_label: null,
          progress_step: null,
          progress_total: null,
        });
        liveAssistantByConvRef.current.delete(conversationId);
        patchRunState(conversationId, {
          isRunning: false,
          pipelineStep: null,
          analysisStartTime: null,
        });
        toast({
          title: "Hintergrund-Aufgabe fehlgeschlagen",
          description: "Dateien für eine wartende Analyse fehlen (z. B. nach Neuladen der Seite).",
          variant: "destructive",
        });
        return;
      }

      pendingFilePayloadsRef.current.delete(job.id);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !supabaseKey) {
        await updateJobRow(job.id, {
          status: "failed",
          finished_at: new Date().toISOString(),
          error: "Backend nicht verbunden.",
        });
        liveAssistantByConvRef.current.delete(conversationId);
        patchRunState(conversationId, { isRunning: false, pipelineStep: null, analysisStartTime: null });
        return;
      }

      const dbMsgs = await loadMessages(conversationId);
      const apiMessages = dbMsgs.map((m) => ({ role: m.role, content: m.content }));

      let lastEngine3Result: ChatMessage["engine3Result"] | undefined;
      for (let i = dbMsgs.length - 1; i >= 0; i--) {
        if (dbMsgs[i].role !== "assistant") continue;
        const s = parseMessageStructured(dbMsgs[i].structured_content as Json);
        if (s?.engine3Result) {
          lastEngine3Result = s.engine3Result;
          break;
        }
      }

      const controller = new AbortController();
      abortByJobIdRef.current.set(job.id, controller);
      const timeoutId = setTimeout(() => controller.abort(), 300_000);

      const startTs = Date.now();
      patchRunState(conversationId, {
        isRunning: true,
        analysisStartTime: startTs,
        pipelineStep: null,
      });

      const upsertAssistantUi = (
        assistantContent: string,
        invoiceData?: ChatMessage["invoiceResult"],
        serviceBillingData?: ChatMessage["serviceBillingResult"],
        engine3Data?: ChatMessage["engine3Result"],
        analysisTimeSeconds?: number,
        messageId?: string,
        frageAnswer?: ChatMessage["frageAnswer"],
      ) => {
        const prevLive = liveAssistantByConvRef.current.get(conversationId);
        const mergedFrage = frageAnswer !== undefined ? frageAnswer : prevLive?.frageAnswer;
        const mergedInv = invoiceData !== undefined ? invoiceData : prevLive?.invoiceResult;
        const mergedSvc = serviceBillingData !== undefined ? serviceBillingData : prevLive?.serviceBillingResult;
        const mergedE3 = engine3Data !== undefined ? engine3Data : prevLive?.engine3Result;
        liveAssistantByConvRef.current.set(conversationId, {
          content: assistantContent,
          invoiceResult: mergedInv,
          serviceBillingResult: mergedSvc,
          engine3Result: mergedE3,
          ...(analysisTimeSeconds != null ? { analysisTimeSeconds } : {}),
          ...(mergedFrage !== undefined ? { frageAnswer: mergedFrage } : {}),
        });
        if (activeConversationIdRef.current !== conversationId) return;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) =>
              i === prev.length - 1
                ? {
                    ...m,
                    id: messageId ?? m.id,
                    content: assistantContent,
                    invoiceResult: invoiceData !== undefined ? invoiceData : m.invoiceResult,
                    serviceBillingResult:
                      serviceBillingData !== undefined ? serviceBillingData : m.serviceBillingResult,
                    engine3Result: engine3Data !== undefined ? engine3Data : m.engine3Result,
                    ...(analysisTimeSeconds != null ? { analysisTimeSeconds } : {}),
                    ...(frageAnswer !== undefined ? { frageAnswer } : {}),
                    kurzantwortenVorschlagStatus: m.kurzantwortenVorschlagStatus,
                  }
                : m,
            );
          }
          return [
            ...prev,
            {
              id: messageId ?? crypto.randomUUID(),
              role: "assistant" as const,
              content: assistantContent,
              invoiceResult: invoiceData,
              serviceBillingResult: serviceBillingData,
              engine3Result: engine3Data,
              ...(analysisTimeSeconds != null ? { analysisTimeSeconds } : {}),
              ...(frageAnswer !== undefined ? { frageAnswer } : {}),
            },
          ];
        });
      };

      try {
        const extra_rules = [globalSettings.default_rules, userSettings.custom_rules].filter(Boolean).join("\n\n");
        const jobPayload = (job.payload ?? {}) as BackgroundJobPayload;
        const result = await executeGoaeChatRequest({
          supabaseKey,
          apiMessages,
          filePayloads: filePayloads && filePayloads.length > 0 ? filePayloads : undefined,
          model: effectiveModel,
          engine_type: userSettings.engine_type ?? globalSettings.default_engine,
          extra_rules,
          kurzantworten: userSettings.kurzantworten === true,
          kontext_wissen: userSettings.kontext_wissen === false ? false : undefined,
          lastEngine3Result,
          guidedWorkflow: jobPayload.guidedWorkflow,
          guidedPhase: jobPayload.guidedPhase,
          signal: controller.signal,
          onProgress: (p) => {
            void updateJobProgressDb(job.id, {
              progress_label: p?.label ?? null,
              progress_step: p?.step ?? null,
              progress_total: p?.totalSteps ?? null,
            });
            // #region agent log
            fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "691e35" },
              body: JSON.stringify({
                sessionId: "691e35",
                location: "useBackgroundJobQueue.ts:onProgress",
                message: "UI pipeline step patch",
                data: {
                  conversationId,
                  jobId: job.id,
                  step: p?.step ?? null,
                  totalSteps: p?.totalSteps ?? null,
                },
                timestamp: Date.now(),
                hypothesisId: "H4",
              }),
            }).catch(() => {});
            // #endregion
            patchRunState(conversationId, { pipelineStep: p, isRunning: true, analysisStartTime: startTs });
          },
          onStreamState: (state) => {
            upsertAssistantUi(
              state.assistantContent,
              state.invoiceData,
              state.serviceBillingData,
              state.engine3Data,
              undefined,
              undefined,
              state.frageStructured,
            );
          },
          onFreeModelsExhausted: onFreeModelsExhausted,
        });

        clearTimeout(timeoutId);
        abortByJobIdRef.current.delete(job.id);

        if (!result.ok) {
          if (result.error.kind === "http") {
            if (result.error.status === 429) {
              toast({ title: "Rate Limit", description: "Zu viele Anfragen.", variant: "destructive" });
            } else if (result.error.status === 402) {
              toast({
                title: "Credits erschöpft",
                description: "Bitte Credits aufladen oder ein kostenloses Modell wählen.",
                variant: "destructive",
              });
            } else {
              const b = result.error.body;
              if (b?.code === "FREE_MODELS_EXHAUSTED") {
                const parts = [b?.error, b?.details].filter(Boolean) as string[];
                onFreeModelsExhausted(parts.length ? parts.join("\n\n") : null);
              } else {
                toast({
                  title: "Fehler",
                  description: b?.error ?? "Die Anfrage konnte nicht verarbeitet werden.",
                  variant: "destructive",
                });
              }
            }
          } else {
            const rawMsg = result.error.message;
            const errMsg = /failed to fetch|networkerror|load failed/i.test(rawMsg)
              ? "Netzwerkfehler: Verbindung zum Server nicht möglich."
              : rawMsg;
            toast({ title: "Fehler", description: errMsg, variant: "destructive" });
          }
          await updateJobRow(job.id, {
            status: "failed",
            finished_at: new Date().toISOString(),
            error: "Anfrage fehlgeschlagen.",
            progress_label: null,
            progress_step: null,
            progress_total: null,
          });
          liveAssistantByConvRef.current.delete(conversationId);
          patchRunState(conversationId, { isRunning: false, pipelineStep: null, analysisStartTime: null });
          return;
        }

        const { state, analysisTimeSeconds } = result;
        upsertAssistantUi(
          state.assistantContent,
          state.invoiceData,
          state.serviceBillingData,
          state.engine3Data,
          analysisTimeSeconds,
          undefined,
          state.frageStructured,
        );
        // #region agent log
        if (state.engine3Data != null && !state.assistantContent?.trim()) {
          fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "c5a6a3" },
            body: JSON.stringify({
              sessionId: "c5a6a3",
              location: "useBackgroundJobQueue.ts:afterSse",
              message: "job complete: engine3 without assistant text",
              data: {
                persistPlaceholderLen: state.engine3Data ? "[DocBill: Engine 3 – strukturiertes Ergebnis]".length : 0,
              },
              timestamp: Date.now(),
              hypothesisId: "H3",
            }),
          }).catch(() => {});
        }
        // #endregion

        const assistantStructured = buildAssistantStructuredContent({
          invoiceResult: state.invoiceData,
          serviceBillingResult: state.serviceBillingData,
          engine3Result: state.engine3Data,
          analysisTimeSeconds,
          frageAnswer: state.frageStructured,
        });
        const hasAssistantText =
          Boolean(state.assistantContent?.trim()) ||
          Boolean(state.frageStructured) ||
          Boolean(state.engine3Data);
        const contentToPersist =
          state.assistantContent?.trim()
            ? state.assistantContent
            : state.frageStructured
              ? frageAnswerToMarkdown(state.frageStructured)
              : state.engine3Data
                ? "[DocBill: Engine 3 – strukturiertes Ergebnis]"
                : "";
        if (hasAssistantText || assistantStructured) {
          const savedId = await saveMessage(
            conversationId,
            "assistant",
            contentToPersist,
            assistantStructured ?? undefined,
          );
          if (savedId) {
            upsertAssistantUi(
              state.assistantContent,
              state.invoiceData,
              state.serviceBillingData,
              state.engine3Data,
              analysisTimeSeconds,
              savedId,
              state.frageStructured,
            );
          }
        }

        const preview =
          state.assistantContent.trim().slice(0, 160) ||
          state.frageStructured?.kurzantwort.trim().slice(0, 160) ||
          (state.invoiceData ? "Rechnungsprüfung abgeschlossen" : "") ||
          (state.serviceBillingData ? "Leistungsvorschläge erstellt" : "") ||
          (state.engine3Data ? "Engine 3 abgeschlossen" : "");

        const sseFailed = assistantContentHasSseError(state.assistantContent);
        const hasDeliverable = sseAccumStateHasDeliverable(state);
        const jobFailed = sseFailed || !hasDeliverable;
        if (!sseFailed && !hasDeliverable) {
          toast({
            title: "Keine Antwort",
            description: "Die Analyse lieferte kein Ergebnis. Bitte versuchen Sie es erneut.",
            variant: "destructive",
          });
        }
        await supabase
          .from("background_jobs")
          .update({
            status: jobFailed ? "failed" : "completed",
            finished_at: new Date().toISOString(),
            ...(jobFailed
              ? {
                  error: sseFailed
                    ? sseErrorSummaryFromAssistantContent(state.assistantContent)
                    : "Keine Antwort erhalten.",
                }
              : { error: null }),
            progress_label: null,
            progress_step: null,
            progress_total: null,
            payload: mergePayload(payload, { assistantPreview: preview }) as unknown as Record<string, unknown>,
          })
          .eq("id", job.id);

        if (!jobFailed) {
          const userMsgs = dbMsgs.filter((m) => m.role === "user");
          const userTextForTitle = userMsgs[0]?.content ?? "";
          const initialAutoTitle = buildConversationTitle({
            userText: userTextForTitle,
            fileNames,
            status: "queued",
          });
          const effectiveEngine =
            (userSettings.engine_type && userSettings.engine_type.trim() !== ""
              ? userSettings.engine_type
              : globalSettings.default_engine) ?? "";
          const resultStatus =
            state.invoiceData
              ? "invoice"
              : state.serviceBillingData
                ? "service"
                : state.engine3Data
                  ? "engine3"
                  : effectiveEngine === "direct"
                    ? "direct"
                    : effectiveEngine === "direct_local"
                      ? "direct_local"
                      : "generic";
          const finalTitle = buildConversationTitle({
            userText: userTextForTitle,
            fileNames,
            status: resultStatus,
          });
          const { data: convRow } = await supabase
            .from("conversations")
            .select("title")
            .eq("id", conversationId)
            .maybeSingle();
          const currentRaw = (convRow?.title as string | undefined) ?? "";
          const currentDisplay = conversationListTitleDisplay(currentRaw);
          const currentNorm = currentRaw.trim();
          const initialNorm = initialAutoTitle.trim();
          const shouldRefine =
            !currentDisplay || currentNorm === "Neues Gespräch" || currentNorm === initialNorm;
          if (shouldRefine) await updateTitle(conversationId, finalTitle);
        }

        await fetchConversations();
        await fetchJobs();
        liveAssistantByConvRef.current.delete(conversationId);
        clearRunState(conversationId);
      } catch (e) {
        clearTimeout(timeoutId);
        abortByJobIdRef.current.delete(job.id);
        const isAbort = e instanceof Error && e.name === "AbortError";
        if (!isAbort) {
          console.error("executeJob", e);
          toast({
            title: "Fehler",
            description: e instanceof Error ? e.message : "Unbekannter Fehler",
            variant: "destructive",
          });
        }
        await updateJobRow(job.id, {
          status: isAbort ? "cancelled" : "failed",
          finished_at: new Date().toISOString(),
          error: isAbort ? null : e instanceof Error ? e.message : "Fehler",
          progress_label: null,
          progress_step: null,
          progress_total: null,
        });
        liveAssistantByConvRef.current.delete(conversationId);
        patchRunState(conversationId, { isRunning: false, pipelineStep: null, analysisStartTime: null });
      }
    },
    [
      loadMessages,
      globalSettings,
      userSettings,
      effectiveModel,
      saveMessage,
      fetchConversations,
      updateJobRow,
      patchRunState,
      clearRunState,
      toast,
      onFreeModelsExhausted,
      setMessages,
      fetchJobs,
      updateJobProgressDb,
      updateTitle,
    ],
  );

  const drainQueue = useCallback(async () => {
    if (!user || drainMutexRef.current) return;
    drainMutexRef.current = true;
    try {
      while (runningJobIdsRef.current.size < MAX_CONCURRENT_BACKGROUND_JOBS) {
        const job = await claimNextQueuedJob();
        if (!job) break;
        runningJobIdsRef.current.add(job.id);
        void executeJob(job).finally(() => {
          runningJobIdsRef.current.delete(job.id);
          void drainQueue();
          void fetchJobs();
        });
      }
    } finally {
      drainMutexRef.current = false;
    }
  }, [user, claimNextQueuedJob, executeJob, fetchJobs]);

  const hasBlockingJobForConversation = useCallback(
    (conversationId: string) =>
      jobsRef.current.some(
        (j) => j.conversation_id === conversationId && (j.status === "queued" || j.status === "running"),
      ),
    [],
  );

  const enqueueSend = useCallback(
    async (
      content: string,
      files: File[] | undefined,
      guided?: { workflow: GuidedWorkflowKind; phase: "collect" },
    ) => {
      if (!user) {
        toast({ title: "Anmeldung nötig", description: "Bitte melden Sie sich an, um Analysen zu starten." });
        return;
      }

      const tasks = buildTaskList(content, files).map((t, idx) =>
        idx === 0 && guided ? { ...t, guided } : t,
      );
      const singleTaskUsesActive = tasks.length === 1 && activeConversationId !== null;

      if (singleTaskUsesActive && activeConversationId && hasBlockingJobForConversation(activeConversationId)) {
        toast({
          title: "Bitte warten",
          description: "In diesem Gespräch läuft bereits eine Analyse oder eine steht in der Warteschlange.",
        });
        return;
      }

      const attachmentsFor = (taskFiles?: File[]) =>
        taskFiles?.map((f) => ({
          name: f.name,
          type: f.type,
          previewUrl:
            f.type.startsWith("image/") || f.type === "application/pdf"
              ? URL.createObjectURL(f)
              : undefined,
        }));

      const { data: maxRow } = await supabase
        .from("background_jobs")
        .select("sort_order")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      let sortCursor = (maxRow?.sort_order as number | undefined) ?? 0;

      let isEmptyActiveConversation = false;
      if (tasks.length === 1 && activeConversationId) {
        const existingMsgs = await loadMessages(activeConversationId);
        isEmptyActiveConversation = existingMsgs.length === 0;
      }

      for (let i = 0; i < tasks.length; i++) {
        const spec = tasks[i];
        const fileNamesForTitle = spec.files?.map((f) => f.name) ?? [];
        const listTitle = buildConversationTitle({
          userText: spec.content,
          fileNames: fileNamesForTitle,
          status: fileNamesForTitle.length > 0 ? "queued" : "generic",
        });
        let convId: string | null = null;

        if (tasks.length === 1 && activeConversationId) {
          convId = activeConversationId;
        } else {
          convId = await createConversation(listTitle);
        }

        if (!convId) {
          toast({ title: "Fehler", description: "Gespräch konnte nicht angelegt werden.", variant: "destructive" });
          break;
        }

        if (i === 0 && !(tasks.length === 1 && activeConversationId)) {
          setActiveConversationId(convId);
        }

        const filePayloads =
          spec.files && spec.files.length > 0
            ? await Promise.all(
                spec.files.map(async (f) => ({
                  name: f.name,
                  type: f.type,
                  data: await fileToBase64(f),
                })),
              )
            : [];
        const userStructured = buildUserStructuredContent(filePayloads);
        const savedUserId = await saveMessage(
          convId,
          "user",
          spec.content,
          userStructured ?? undefined,
        );
        const userMsg: ChatMessage = {
          id: savedUserId ?? crypto.randomUUID(),
          role: "user",
          content: spec.content,
          attachments: attachmentsFor(spec.files),
        };

        if (tasks.length === 1) {
          if (convId === activeConversationId) {
            setMessages((prev) => [...prev, userMsg]);
          } else if (i === 0) {
            setMessages([userMsg]);
          }
        }

        if (isEmptyActiveConversation && i === 0 && convId === activeConversationId) {
          await updateTitle(convId, listTitle);
        }
        if (spec.files?.[0]) await updateSourceFilename(convId, spec.files[0].name);

        sortCursor += 1;
        const jobPayload: BackgroundJobPayload = {
          fileNames: spec.files?.map((f) => f.name) ?? [],
          ...(spec.guided?.workflow && spec.guided?.phase
            ? { guidedWorkflow: spec.guided.workflow, guidedPhase: spec.guided.phase }
            : {}),
        };

        const { data: jobRow, error: insErr } = await supabase
          .from("background_jobs")
          .insert({
            user_id: user.id,
            conversation_id: convId,
            status: "queued",
            sort_order: sortCursor,
            payload: jobPayload as unknown as Record<string, unknown>,
          })
          .select()
          .single();

        if (insErr || !jobRow) {
          console.error(insErr);
          toast({ title: "Fehler", description: "Aufgabe konnte nicht eingereiht werden.", variant: "destructive" });
          break;
        }

        const jobId = jobRow.id as string;
        if (filePayloads.length > 0) pendingFilePayloadsRef.current.set(jobId, filePayloads);
      }

      await fetchJobs();
      await fetchConversations();
      void drainQueue();
    },
    [
      user,
      activeConversationId,
      createConversation,
      saveMessage,
      loadMessages,
      updateSourceFilename,
      updateTitle,
      setActiveConversationId,
      setMessages,
      toast,
      hasBlockingJobForConversation,
      fetchJobs,
      fetchConversations,
      drainQueue,
    ],
  );

  const stopBackgroundForActiveConversation = useCallback(async () => {
    const aid = activeConversationIdRef.current;
    if (!aid) return;
    const now = new Date().toISOString();
    for (const j of jobsRef.current) {
      if (j.conversation_id !== aid) continue;
      if (j.status === "running") {
        abortByJobIdRef.current.get(j.id)?.abort();
      }
      if (j.status === "queued") {
        pendingFilePayloadsRef.current.delete(j.id);
        await supabase
          .from("background_jobs")
          .update({
            status: "cancelled",
            finished_at: now,
            progress_label: null,
            progress_step: null,
            progress_total: null,
          })
          .eq("id", j.id);
      }
    }
    patchRunState(aid, { isRunning: false, pipelineStep: null, analysisStartTime: null });
    await fetchJobs();
  }, [fetchJobs, patchRunState]);

  const cancelQueuedJob = useCallback(
    async (jobId: string) => {
      const row = jobs.find((j) => j.id === jobId);
      if (!row || row.status !== "queued") return;
      pendingFilePayloadsRef.current.delete(jobId);
      await supabase
        .from("background_jobs")
        .update({
          status: "cancelled",
          finished_at: new Date().toISOString(),
          progress_label: null,
          progress_step: null,
          progress_total: null,
        })
        .eq("id", jobId);
      await fetchJobs();
      void drainQueue();
    },
    [jobs, fetchJobs, drainQueue],
  );

  const isConversationBusy = useCallback(
    (convId: string | null) => {
      if (!convId) return false;
      const rs = runStates[convId];
      if (rs?.isRunning) return true;
      return jobs.some(
        (j) => j.conversation_id === convId && (j.status === "queued" || j.status === "running"),
      );
    },
    [jobs, runStates],
  );

  const activeRunInfo = activeConversationId ? runStates[activeConversationId] : undefined;

  const mergeMessagesWithLiveStream = useCallback(
    async (conversationId: string): Promise<ChatMessage[]> => {
      const db = await loadMessages(conversationId);
      const base: ChatMessage[] = db.map((m) => dbRowToChatMessage(m));
      const live = liveAssistantByConvRef.current.get(conversationId);
      if (
        !live ||
        (!live.content?.trim() &&
          !live.invoiceResult &&
          !live.serviceBillingResult &&
          !live.engine3Result &&
          !live.frageAnswer)
      ) {
        return base;
      }
      const last = base[base.length - 1];
      const mergedLast: ChatMessage = {
        id: last?.role === "assistant" ? last.id : crypto.randomUUID(),
        role: "assistant",
        content: live.content ?? "",
        invoiceResult: live.invoiceResult,
        serviceBillingResult: live.serviceBillingResult,
        engine3Result: live.engine3Result,
        analysisTimeSeconds: live.analysisTimeSeconds,
        frageAnswer: live.frageAnswer,
        kurzantwortenVorschlagStatus:
          last?.role === "assistant" ? last.kurzantwortenVorschlagStatus : undefined,
      };
      if (last?.role === "assistant") {
        return [...base.slice(0, -1), mergedLast];
      }
      return [...base, mergedLast];
    },
    [loadMessages],
  );

  return {
    jobs,
    runStates,
    fetchJobs,
    enqueueSend,
    activeRunInfo,
    isConversationBusy,
    stopBackgroundForActiveConversation,
    cancelQueuedJob,
    mergeMessagesWithLiveStream,
  };
}
