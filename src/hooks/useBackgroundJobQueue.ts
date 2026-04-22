import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage } from "@/components/ChatBubble";
import { dbRowToChatMessage } from "@/lib/dbMessageToChatMessage";
import { executeGoaeChatRequest } from "@/lib/executeGoaeChatRequest";
import {
  filePayloadStoredToFile,
  jobAttachmentObjectPath,
  storageRefsToFilePayloads,
  uploadFilesToJobUploads,
  type JobStorageRef,
} from "@/lib/uploads/jobUploads";
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
  type PipelineProgressPayload,
} from "@/lib/goaeChatSse";
import {
  buildConversationTitle,
  conversationListTitleDisplay,
} from "@/lib/conversationTitle";
import { validateEngine3CaseGroups as validateE3CaseGroups } from "@/lib/engine3CaseGroupsValidate";
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

export type BackgroundJobExecutionSnapshot = {
  model: string;
  engine_type: string;
  extra_rules: string;
  kurzantworten?: boolean;
  kontext_wissen?: boolean;
  pseudonym_session_id?: string;
  regelwerk?: "GOAE" | "EBM";
  mode?: "A" | "B" | "C";
};

export type BackgroundJobPayload = {
  fileNames?: string[];
  /** Persistente Pfade im Bucket `job-uploads` (Cloud-Upload). */
  storage_refs?: JobStorageRef[];
  /** Eingefrorene Parameter für Server-Worker. */
  execution?: BackgroundJobExecutionSnapshot;
  assistantPreview?: string;
  guidedWorkflow?: GuidedWorkflowKind;
  guidedPhase?: "collect";
  /** Fortsetzung nach Segmentierungs-Rückfrage (Rechnungsprüfung, mehrere PDFs). */
  engine3CaseGroups?: number[][];
  /** Optional: Gesamtzahl Rechnungen (z. B. Batch) für Fortschritt „x von y“ wenn totalCases in SSE fehlt. */
  batchRechnungTotal?: number;
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
  pipelineStep: PipelineProgressPayload | null;
  analysisStartTime: number | null;
  /** Spec 03 §5.3 — Dateinamen für Upload-/Parsing-Fortschritt */
  progressFileNames?: string[];
  /** Absicherung „Rechnung x von y“ wenn SSE kein totalCases sendet */
  batchRechnungTotal?: number;
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
  /** Dateien für „Segmentierung bestätigen“ bis zur erfolgreichen Engine-3-Antwort. */
  const pendingEngine3FilesByConversationRef = useRef(
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
        | "engine3Cases"
        | "engine3SegmentationProposal"
        | "analysisTimeSeconds"
        | "frageAnswer"
        | "docbillAnalyse"
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
      const jobPayload = payload as BackgroundJobPayload;
      const storageRefs = jobPayload.storage_refs;
      const hasStorageFiles = Boolean(storageRefs && storageRefs.length > 0);
      const batchRechnungTotal =
        typeof jobPayload.batchRechnungTotal === "number" && Number.isFinite(jobPayload.batchRechnungTotal)
          ? jobPayload.batchRechnungTotal
          : undefined;
      const needsFiles = fileNames.length > 0;
      const filePayloads = pendingFilePayloadsRef.current.get(job.id);
      const haveInlineFiles = Boolean(filePayloads && filePayloads.length > 0);
      if (needsFiles && !hasStorageFiles && !haveInlineFiles) {
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
          progressFileNames: undefined,
          batchRechnungTotal: undefined,
        });
        toast({
          title: "Hintergrund-Aufgabe fehlgeschlagen",
          description: "Dateien für eine wartende Analyse fehlen (z. B. nach Neuladen der Seite).",
          variant: "destructive",
        });
        return;
      }

      const filePayloadsSnapshot =
        filePayloads && filePayloads.length > 0 ? filePayloads.map((f) => ({ ...f })) : [];

      pendingFilePayloadsRef.current.delete(job.id);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      if (!supabaseUrl) {
        await updateJobRow(job.id, {
          status: "failed",
          finished_at: new Date().toISOString(),
          error: "Backend nicht verbunden.",
        });
        liveAssistantByConvRef.current.delete(conversationId);
        patchRunState(conversationId, {
          isRunning: false,
          pipelineStep: null,
          analysisStartTime: null,
          progressFileNames: undefined,
          batchRechnungTotal: undefined,
        });
        return;
      }

      let { data: sessionData } = await supabase.auth.getSession();
      let accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        const { data: ref } = await supabase.auth.refreshSession();
        accessToken = ref.session?.access_token;
      }
      if (!accessToken) {
        const again = await supabase.auth.getSession();
        accessToken = again.data.session?.access_token;
      }
      if (!accessToken) {
        await updateJobRow(job.id, {
          status: "failed",
          finished_at: new Date().toISOString(),
          error: "Sitzung abgelaufen. Bitte neu anmelden und erneut hochladen.",
        });
        liveAssistantByConvRef.current.delete(conversationId);
        patchRunState(conversationId, {
          isRunning: false,
          pipelineStep: null,
          analysisStartTime: null,
          progressFileNames: undefined,
          batchRechnungTotal: undefined,
        });
        toast({
          title: "Anmeldung nötig",
          description: "Für Analysen mit Cloud-Dateien bitte erneut anmelden.",
          variant: "destructive",
        });
        return;
      }

      const dbMsgs = await loadMessages(conversationId);
      const apiMessages = dbMsgs.map((m) => ({ role: m.role, content: m.content }));

      let lastEngine3Result: ChatMessage["engine3Result"] | undefined;
      for (let i = dbMsgs.length - 1; i >= 0; i--) {
        if (dbMsgs[i].role !== "assistant") continue;
        const s = parseMessageStructured(dbMsgs[i].structured_content as Json);
        if (s?.engine3Cases?.length) {
          lastEngine3Result = s.engine3Cases[0].result;
          break;
        }
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
        pipelineStep: {
          step: 1,
          totalSteps: 6,
          label: "Dokument wird vorbereitet…",
        },
        progressFileNames: fileNames.length > 0 ? fileNames : undefined,
        batchRechnungTotal,
      });

      const upsertAssistantUi = (
        assistantContent: string,
        invoiceData?: ChatMessage["invoiceResult"],
        serviceBillingData?: ChatMessage["serviceBillingResult"],
        engine3Data?: ChatMessage["engine3Result"],
        analysisTimeSeconds?: number,
        messageId?: string,
        frageAnswer?: ChatMessage["frageAnswer"],
        engine3Cases?: ChatMessage["engine3Cases"],
        engine3SegmentationProposal?: ChatMessage["engine3SegmentationProposal"],
        docbillAnalyse?: ChatMessage["docbillAnalyse"],
      ) => {
        const prevLive = liveAssistantByConvRef.current.get(conversationId);
        const mergedFrage = frageAnswer !== undefined ? frageAnswer : prevLive?.frageAnswer;
        const mergedDocbill =
          docbillAnalyse !== undefined ? docbillAnalyse : prevLive?.docbillAnalyse;
        const mergedInv = invoiceData !== undefined ? invoiceData : prevLive?.invoiceResult;
        const mergedSvc = serviceBillingData !== undefined ? serviceBillingData : prevLive?.serviceBillingResult;
        const mergedE3 = engine3Data !== undefined ? engine3Data : prevLive?.engine3Result;
        const mergedCases = engine3Cases !== undefined ? engine3Cases : prevLive?.engine3Cases;
        const mergedSeg =
          engine3SegmentationProposal !== undefined
            ? engine3SegmentationProposal
            : prevLive?.engine3SegmentationProposal;
        liveAssistantByConvRef.current.set(conversationId, {
          content: assistantContent,
          invoiceResult: mergedInv,
          serviceBillingResult: mergedSvc,
          engine3Result: mergedE3,
          engine3Cases: mergedCases,
          engine3SegmentationProposal: mergedSeg,
          ...(analysisTimeSeconds != null ? { analysisTimeSeconds } : {}),
          ...(mergedFrage !== undefined ? { frageAnswer: mergedFrage } : {}),
          ...(mergedDocbill !== undefined ? { docbillAnalyse: mergedDocbill } : {}),
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
                    engine3Cases: engine3Cases !== undefined ? engine3Cases : m.engine3Cases,
                    engine3SegmentationProposal:
                      engine3SegmentationProposal !== undefined
                        ? engine3SegmentationProposal
                        : m.engine3SegmentationProposal,
                    ...(analysisTimeSeconds != null ? { analysisTimeSeconds } : {}),
                    ...(frageAnswer !== undefined ? { frageAnswer } : {}),
                    ...(docbillAnalyse !== undefined ? { docbillAnalyse } : {}),
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
              engine3Cases,
              engine3SegmentationProposal,
              ...(analysisTimeSeconds != null ? { analysisTimeSeconds } : {}),
              ...(frageAnswer !== undefined ? { frageAnswer } : {}),
              ...(docbillAnalyse !== undefined ? { docbillAnalyse } : {}),
            },
          ];
        });
      };

      try {
        const extra_rules = [globalSettings.default_rules, userSettings.custom_rules].filter(Boolean).join("\n\n");
        const result = await executeGoaeChatRequest({
          supabaseKey: accessToken,
          apiMessages,
          filePayloads: hasStorageFiles
            ? undefined
            : filePayloadsSnapshot.length > 0
              ? filePayloadsSnapshot
              : undefined,
          storage_file_refs: hasStorageFiles ? storageRefs : undefined,
          model: effectiveModel,
          engine_type: userSettings.engine_type ?? globalSettings.default_engine,
          extra_rules,
          pseudonym_session_id: conversationId,
          kurzantworten: userSettings.kurzantworten === true,
          kontext_wissen: userSettings.kontext_wissen === false ? false : undefined,
          lastEngine3Result,
          guidedWorkflow: jobPayload.guidedWorkflow,
          guidedPhase: jobPayload.guidedPhase,
          ...(jobPayload.engine3CaseGroups?.length
            ? { engine3CaseGroups: jobPayload.engine3CaseGroups }
            : {}),
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
            patchRunState(conversationId, {
              pipelineStep: p,
              isRunning: true,
              analysisStartTime: startTs,
              progressFileNames: fileNames.length > 0 ? fileNames : undefined,
              batchRechnungTotal,
            });
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
              state.engine3Cases,
              state.engine3SegmentationPending ?? undefined,
              state.docbillAnalyse,
            );
          },
          onFreeModelsExhausted: onFreeModelsExhausted,
        });

        clearTimeout(timeoutId);
        abortByJobIdRef.current.delete(job.id);

        if (result.ok === false) {
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
          patchRunState(conversationId, {
            isRunning: false,
            pipelineStep: null,
            analysisStartTime: null,
            progressFileNames: undefined,
            batchRechnungTotal: undefined,
          });
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
          state.engine3Cases,
          state.engine3SegmentationPending ?? undefined,
          state.docbillAnalyse,
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

        const engine3CasesStored =
          state.engine3Cases && state.engine3Cases.length > 0 ? state.engine3Cases : undefined;
        const assistantStructured = buildAssistantStructuredContent({
          invoiceResult: state.invoiceData,
          serviceBillingResult: state.serviceBillingData,
          engine3Result: engine3CasesStored ? undefined : state.engine3Data,
          engine3Cases: engine3CasesStored,
          engine3SegmentationProposal: state.engine3SegmentationPending ?? undefined,
          analysisTimeSeconds,
          frageAnswer: state.frageStructured,
          docbillAnalyse: state.docbillAnalyse,
        });
        const hasAssistantText =
          Boolean(state.assistantContent?.trim()) ||
          Boolean(state.frageStructured) ||
          Boolean(state.engine3Data) ||
          Boolean(engine3CasesStored?.length) ||
          Boolean(state.engine3SegmentationPending) ||
          Boolean(state.docbillAnalyse);
        const contentToPersist =
          state.assistantContent?.trim()
            ? state.assistantContent
            : state.frageStructured
              ? frageAnswerToMarkdown(state.frageStructured)
              : engine3CasesStored
                ? "[DocBill: Engine 3 – mehrere Vorgänge]"
                : state.engine3Data
                  ? "[DocBill: Engine 3 – strukturiertes Ergebnis]"
                  : state.engine3SegmentationPending
                    ? "[DocBill: Engine 3 – Zuordnung offen]"
                    : state.docbillAnalyse
                      ? "[DocBill: Pflichtanalyse]"
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
              state.engine3Cases,
              state.engine3SegmentationPending ?? undefined,
              state.docbillAnalyse,
            );
          }
        }

        if (state.engine3SegmentationPending) {
          let snap = filePayloadsSnapshot;
          if (snap.length === 0 && hasStorageFiles && storageRefs && storageRefs.length > 0) {
            try {
              snap = await storageRefsToFilePayloads(storageRefs);
            } catch (e) {
              console.error("storageRefsToFilePayloads", e);
            }
          }
          if (snap.length > 0) {
            pendingEngine3FilesByConversationRef.current.set(conversationId, snap);
          }
        }
        if (!state.engine3SegmentationPending && (engine3CasesStored?.length || state.engine3Data)) {
          pendingEngine3FilesByConversationRef.current.delete(conversationId);
        }

        const preview =
          state.assistantContent.trim().slice(0, 160) ||
          state.frageStructured?.kurzantwort.trim().slice(0, 160) ||
          (state.invoiceData ? "Rechnungsprüfung abgeschlossen" : "") ||
          (state.serviceBillingData ? "Leistungsvorschläge erstellt" : "") ||
          (engine3CasesStored ? "Engine 3: mehrere Vorgänge" : "") ||
          (state.engine3Data ? "Engine 3 abgeschlossen" : "") ||
          (state.engine3SegmentationPending ? "Engine 3: Zuordnung offen" : "") ||
          (state.docbillAnalyse ? "Pflichtanalyse" : "");

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
            payload: mergePayload(payload, { assistantPreview: preview }) as unknown as Json,
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
                : state.engine3Data || engine3CasesStored?.length
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
        patchRunState(conversationId, {
          isRunning: false,
          pipelineStep: null,
          analysisStartTime: null,
          progressFileNames: undefined,
          batchRechnungTotal: undefined,
        });
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
          /* Fehler-Toast liefert createConversation (z. B. RLS, fehlende Organisation) */
          break;
        }

        if (i === 0 && !(tasks.length === 1 && activeConversationId)) {
          setActiveConversationId(convId);
        }

        sortCursor += 1;
        const jobPayloadBase: BackgroundJobPayload = {
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
            payload: jobPayloadBase as unknown as Json,
          })
          .select()
          .single();

        if (insErr || !jobRow) {
          console.error(insErr);
          toast({ title: "Fehler", description: "Aufgabe konnte nicht eingereiht werden.", variant: "destructive" });
          break;
        }

        const jobId = jobRow.id as string;
        let userStructured = null as ReturnType<typeof buildUserStructuredContent>;

        if (spec.files && spec.files.length > 0) {
          const paths = spec.files.map((f) => jobAttachmentObjectPath(user.id, jobId, f));
          try {
            await uploadFilesToJobUploads(paths, spec.files);
          } catch (e) {
            console.error(e);
            await supabase
              .from("background_jobs")
              .update({
                status: "failed",
                finished_at: new Date().toISOString(),
                error: "Dateiupload in den Cloud-Speicher fehlgeschlagen.",
                progress_label: null,
                progress_step: null,
                progress_total: null,
              })
              .eq("id", jobId);
            toast({
              title: "Upload fehlgeschlagen",
              description: "Die Dateien konnten nicht im Cloud-Speicher abgelegt werden.",
              variant: "destructive",
            });
            break;
          }
          const storage_refs: JobStorageRef[] = paths.map((path, fi) => ({
            path,
            name: spec.files![fi].name,
            content_type: spec.files![fi].type || "application/octet-stream",
            size: spec.files![fi].size,
          }));
          const extra_rules_enqueue = [globalSettings.default_rules, userSettings.custom_rules]
            .filter(Boolean)
            .join("\n\n");
          const execution: BackgroundJobExecutionSnapshot = {
            model: effectiveModel,
            engine_type: userSettings.engine_type ?? globalSettings.default_engine,
            extra_rules: extra_rules_enqueue,
            kurzantworten: userSettings.kurzantworten === true,
            kontext_wissen: userSettings.kontext_wissen !== false,
            pseudonym_session_id: convId,
          };
          const { error: payErr } = await supabase
            .from("background_jobs")
            .update({
              payload: { ...jobPayloadBase, storage_refs, execution } as unknown as Json,
            })
            .eq("id", jobId);
          if (payErr) console.error(payErr);
          userStructured = buildUserStructuredContent(
            storage_refs.map((r) => ({
              name: r.name,
              type: r.content_type,
              storage_path: r.path,
            })),
          );
        }

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
      effectiveModel,
      userSettings,
      globalSettings,
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
    patchRunState(aid, {
      isRunning: false,
      pipelineStep: null,
      analysisStartTime: null,
      progressFileNames: undefined,
      batchRechnungTotal: undefined,
    });
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

  const resumeEngine3WithCaseGroups = useCallback(
    async (conversationId: string, caseGroups: number[][]) => {
      if (!user) {
        toast({ title: "Anmeldung nötig", description: "Bitte melden Sie sich an.", variant: "destructive" });
        return;
      }
      if (hasBlockingJobForConversation(conversationId)) {
        toast({
          title: "Bitte warten",
          description: "In diesem Gespräch läuft bereits eine Analyse oder eine steht in der Warteschlange.",
        });
        return;
      }
      const files = pendingEngine3FilesByConversationRef.current.get(conversationId);
      if (!files?.length) {
        toast({
          title: "Dateien nicht mehr verfügbar",
          description: "Bitte die PDFs erneut anhängen und eine neue Analyse starten.",
          variant: "destructive",
        });
        return;
      }
      if (!validateE3CaseGroups(files.length, caseGroups)) {
        toast({
          title: "Ungültige Zuordnung",
          description: "Jede Datei muss genau einem Vorgang zugeordnet sein.",
          variant: "destructive",
        });
        return;
      }

      const { data: maxRow } = await supabase
        .from("background_jobs")
        .select("sort_order")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const sortCursor = ((maxRow?.sort_order as number | undefined) ?? 0) + 1;

      const jobPayloadBase: BackgroundJobPayload = {
        fileNames: files.map((f) => f.name),
        engine3CaseGroups: caseGroups,
      };

      const { data: jobRow, error: insErr } = await supabase
        .from("background_jobs")
        .insert({
          user_id: user.id,
          conversation_id: conversationId,
          status: "queued",
          sort_order: sortCursor,
          payload: jobPayloadBase as unknown as Json,
        })
        .select()
        .single();

      if (insErr || !jobRow) {
        console.error(insErr);
        toast({ title: "Fehler", description: "Aufgabe konnte nicht eingereiht werden.", variant: "destructive" });
        return;
      }

      const jobId = jobRow.id as string;
      const uploadable = files.map(filePayloadStoredToFile);
      const paths = uploadable.map((f) => jobAttachmentObjectPath(user.id, jobId, f));
      try {
        await uploadFilesToJobUploads(paths, uploadable);
      } catch (e) {
        console.error(e);
        await supabase
          .from("background_jobs")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            error: "Dateiupload in den Cloud-Speicher fehlgeschlagen.",
          })
          .eq("id", jobId);
        toast({
          title: "Upload fehlgeschlagen",
          description: "Die Dateien konnten nicht im Cloud-Speicher abgelegt werden.",
          variant: "destructive",
        });
        return;
      }
      const storage_refs: JobStorageRef[] = paths.map((path, fi) => ({
        path,
        name: uploadable[fi].name,
        content_type: uploadable[fi].type || "application/octet-stream",
        size: uploadable[fi].size,
      }));
      const extra_rules_e3 = [globalSettings.default_rules, userSettings.custom_rules].filter(Boolean).join("\n\n");
      const execution: BackgroundJobExecutionSnapshot = {
        model: effectiveModel,
        engine_type: userSettings.engine_type ?? globalSettings.default_engine,
        extra_rules: extra_rules_e3,
        kurzantworten: userSettings.kurzantworten === true,
        kontext_wissen: userSettings.kontext_wissen !== false,
        pseudonym_session_id: conversationId,
      };
      await supabase
        .from("background_jobs")
        .update({
          payload: { ...jobPayloadBase, storage_refs, execution } as unknown as Json,
        })
        .eq("id", jobId);
      await fetchJobs();
      void drainQueue();
    },
    [
      user,
      toast,
      hasBlockingJobForConversation,
      fetchJobs,
      drainQueue,
      effectiveModel,
      userSettings,
      globalSettings,
    ],
  );

  const mergeMessagesWithLiveStream = useCallback(
    async (conversationId: string): Promise<ChatMessage[]> => {
      const db = await loadMessages(conversationId);
      const base: ChatMessage[] = db.map((m) =>
        dbRowToChatMessage({
          ...m,
          structured_content: m.structured_content as Json | null | undefined,
        }),
      );
      const live = liveAssistantByConvRef.current.get(conversationId);
      if (
        !live ||
        (!live.content?.trim() &&
          !live.invoiceResult &&
          !live.serviceBillingResult &&
          !live.engine3Result &&
          !live.engine3Cases?.length &&
          !live.engine3SegmentationProposal &&
          !live.frageAnswer &&
          !live.docbillAnalyse)
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
        engine3Cases: live.engine3Cases,
        engine3SegmentationProposal: live.engine3SegmentationProposal,
        analysisTimeSeconds: live.analysisTimeSeconds,
        frageAnswer: live.frageAnswer,
        docbillAnalyse: live.docbillAnalyse,
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
    resumeEngine3WithCaseGroups,
  };
}
