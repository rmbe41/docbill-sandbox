import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type ComponentPropsWithoutRef,
} from "react";
import ReactMarkdown from "react-markdown";
import type { Components, ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { FileText, ThumbsUp, ThumbsDown } from "lucide-react";
import { cn } from "@/lib/utils";
import DocBillLogo from "@/assets/DocBill-Logo.svg";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import InvoiceResult, {
  type InvoiceResultData,
  type SuggestionDecision,
} from "@/components/InvoiceResult";
import ServiceBillingResult, { type ServiceBillingResultData } from "@/components/ServiceBillingResult";
import Engine3Result, { type Engine3ResultData } from "@/components/Engine3Result";
import { BulkReviewQueue, type BulkReviewCase } from "@/components/BulkReviewQueue";
import FileOverlay from "@/components/FileOverlay";
import { useFeedback, type RlFeedbackContext } from "@/hooks/useFeedback";
import { useToast } from "@/hooks/use-toast";
import { FeedbackThanksBurst } from "@/components/FeedbackThanksBurst";
import { DocbillKiDisclaimerFooter } from "@/components/DocbillKiDisclaimerFooter";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  Engine3CaseStored,
  Engine3SegmentationProposalStored,
  MessageStructuredContentV1,
} from "@/lib/messageStructuredContent";
import type { FrageAnswerStructured } from "@/lib/frageAnswerStructured";
import { frageAnswerSuggestsExportFinalize } from "@/lib/frageAnswerStructured";
import type { DocbillAnalyseV1 } from "@/lib/analyse/types";
import { DocbillAnalysePanel } from "@/components/DocbillAnalysePanel";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: { name: string; type: string; previewUrl?: string }[];
  invoiceResult?: InvoiceResultData;
  serviceBillingResult?: ServiceBillingResultData;
  engine3Result?: Engine3ResultData;
  engine3Cases?: Engine3CaseStored[];
  engine3SegmentationProposal?: Engine3SegmentationProposalStored;
  analysisTimeSeconds?: number;
  frageAnswer?: FrageAnswerStructured;
  suggestionDecisions?: {
    invoice?: Record<string, string>;
    service?: Record<string, string>;
    engine3?: Record<string, string>;
  };
  kurzantwortenVorschlagStatus?: Record<string, "accepted" | "rejected">;
  engine3FaktorOverrides?: Record<string, number>;
  engine3BegruendungText?: Record<string, string>;
  serviceBegruendungText?: Record<string, string>;
  docbillAnalyse?: DocbillAnalyseV1;
};

type ChatBubbleProps = {
  message: ChatMessage;
  conversationId?: string | null;
  updateMessageStructuredContent?: (
    messageId: string,
    patch: Partial<MessageStructuredContentV1>,
  ) => Promise<boolean>;
  /** Vorangehendes Nutzer-PDF — nur per Klick im Overlay (Rechnungsprüfung). */
  invoiceReviewSourcePdf?: { previewUrl: string; name: string } | null;
  /** Effektives Modell und Engine für Feedback-/RL-Datensatz. */
  feedbackSessionMeta?: { model: string; engine: string };
  /** Letzte Nachrichten derselben Konversation bis inkl. dieser Bubble. */
  feedbackPriorMessages?: { role: "user" | "assistant"; content: string }[];
  /** Kurzantworten-Vorschlag in den Composer übernehmen (Direktmodus). */
  onKurzantwortVorschlagComposer?: (text: string) => void;
  /** Fortsetzung nach engine3_segmentation_pending (Gruppen von Datei-Indizes). */
  onResumeEngine3WithCaseGroups?: (conversationId: string, caseGroups: number[][]) => void;
  /** Optional: Steigerungsbegründung per KI neu erzeugen (Edge Function goae-chat). */
  begruendungRegenerateContext?: {
    supabaseKey: string;
    model: string;
    kontext_wissen: boolean;
    pseudonym_session_id?: string;
  };
};

const MAX_RL_MSG_CHARS = 4000;

function buildRlFeedbackContext(
  message: ChatMessage,
  sessionMeta: { model: string; engine: string } | undefined,
  priorMessages: { role: "user" | "assistant"; content: string }[] | undefined,
): RlFeedbackContext | undefined {
  const hasStructured =
    message.invoiceResult != null ||
    message.serviceBillingResult != null ||
    message.engine3Result != null ||
    (message.engine3Cases != null && message.engine3Cases.length > 0) ||
    message.frageAnswer != null ||
    message.docbillAnalyse != null;
  const structured_snapshot = hasStructured
    ? {
        ...(message.invoiceResult ? { invoiceResult: message.invoiceResult } : {}),
        ...(message.serviceBillingResult ? { serviceBillingResult: message.serviceBillingResult } : {}),
        ...(message.engine3Result ? { engine3Result: message.engine3Result } : {}),
        ...(message.engine3Cases?.length ? { engine3Cases: message.engine3Cases } : {}),
        ...(message.frageAnswer ? { frageAnswer: message.frageAnswer } : {}),
        ...(message.docbillAnalyse ? { docbillAnalyse: message.docbillAnalyse } : {}),
      }
    : undefined;

  const user_messages =
    priorMessages && priorMessages.length > 0
      ? priorMessages.map((m) => ({
          role: m.role,
          content:
            m.content.length > MAX_RL_MSG_CHARS
              ? `${m.content.slice(0, MAX_RL_MSG_CHARS)}\n…[truncated]`
              : m.content,
        }))
      : undefined;

  const ctx: RlFeedbackContext = {
    ...(sessionMeta ? { model: sessionMeta.model, engine: sessionMeta.engine } : {}),
    ...(user_messages ? { user_messages } : {}),
    ...(structured_snapshot ? { structured_snapshot } : {}),
  };

  if (!ctx.model && !ctx.user_messages?.length && !ctx.structured_snapshot) {
    return undefined;
  }

  return ctx;
}

function assistantMessageFeedbackBody(m: ChatMessage): string {
  const trimmed = m.content?.trim();
  if (trimmed) return m.content;
  if (m.frageAnswer) return "[DocBill: Frage-Antwort strukturiert]";
  if (m.invoiceResult) return "[DocBill: Rechnungsprüfung strukturiert]";
  if (m.serviceBillingResult) return "[DocBill: Gebühren-/Leistungsprüfung strukturiert]";
  if (m.engine3Result || (m.engine3Cases != null && m.engine3Cases.length > 0)) {
    return "[DocBill: Engine 3 strukturiert]";
  }
  if (m.docbillAnalyse) return "[DocBill: Pflichtanalyse]";
  return "";
}

type MdHeadingProps = ComponentPropsWithoutRef<"h1"> & ExtraProps;

function frageHeadingAsP({ children, node: _node, ...props }: MdHeadingProps) {
  return (
    <p className="font-semibold my-1.5 first:mt-0 text-sm" {...(props as ComponentPropsWithoutRef<"p">)}>
      {children}
    </p>
  );
}

// Custom markdown components – flache Typografie, keine Boxen
const markdownComponents: Partial<Components> = {
  h2: ({ children, node: _node, ...props }: ComponentPropsWithoutRef<"h2"> & ExtraProps) => (
    <h2 className="font-semibold mt-6 mb-2 first:mt-0" {...props}>
      {children}
    </h2>
  ),
  hr: ({ node: _node, ...props }: ComponentPropsWithoutRef<"hr"> & ExtraProps) => (
    <hr className="section-divider" {...props} />
  ),
  table: ({ children, node: _node, ...props }: ComponentPropsWithoutRef<"table"> & ExtraProps) => (
    <div className="overflow-x-auto my-4">
      <table {...props}>{children}</table>
    </div>
  ),
};

/** Frage-Structured: keine großen Überschriften in Unterfeldern (Prompt verbietet ###); falls doch, wie Absatz. */
const frageSectionMarkdownComponents: Partial<Components> = {
  ...markdownComponents,
  h1: frageHeadingAsP,
  h2: frageHeadingAsP,
  h3: frageHeadingAsP,
  h4: frageHeadingAsP,
  h5: frageHeadingAsP,
  h6: frageHeadingAsP,
};

function displayNameFromUser(user: SupabaseUser): string | null {
  const m = user.user_metadata ?? {};
  const n =
    (m.full_name as string | undefined)?.trim() ||
    (m.display_name as string | undefined)?.trim() ||
    (m.name as string | undefined)?.trim();
  return n || null;
}

function FrageStructuredReply({
  data,
  vorschlagStatus,
  messageId,
  updateMessageStructuredContent,
  onVorschlagComposer,
}: {
  data: FrageAnswerStructured;
  vorschlagStatus?: Record<string, "accepted" | "rejected">;
  messageId?: string;
  updateMessageStructuredContent?: (
    id: string,
    patch: Partial<MessageStructuredContentV1>,
  ) => Promise<boolean>;
  onVorschlagComposer?: (text: string) => void;
}) {
  const [optimisticVorschlag, setOptimisticVorschlag] = useState<
    Record<string, "accepted" | "rejected">
  >({});
  useEffect(() => {
    setOptimisticVorschlag({});
  }, [messageId]);

  const effectiveVorschlagStatus = { ...vorschlagStatus, ...optimisticVorschlag };

  const persistVorschlagStatus = (id: string, status: "accepted" | "rejected") => {
    setOptimisticVorschlag((prev) => ({ ...prev, [id]: status }));
    if (!messageId || !updateMessageStructuredContent) return;
    void updateMessageStructuredContent(messageId, {
      kurzantwortenVorschlagStatus: { [id]: status },
    });
  };
  return (
    <div className="space-y-4 not-prose text-foreground">
      <section className="rounded-lg border border-border/80 bg-muted/30 px-4 py-3">
        <div className="markdown-output prose prose-sm max-w-none text-sm leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={frageSectionMarkdownComponents}>
            {data.kurzantwort}
          </ReactMarkdown>
        </div>
      </section>
      {onVorschlagComposer && frageAnswerSuggestsExportFinalize(data) ? (
        <section className="pt-1 border-t border-border/30 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Datenexport
          </h3>
          <p className="text-xs text-muted-foreground">
            Soll die Antwort als exportfertige Liste (PDF, TXT, PAD/DAT) finalisiert werden?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() =>
                onVorschlagComposer(
                  "Bitte die in deiner letzten Antwort genannten GOÄ-Positionen als exportfertige Tabelle (TSV/TXT) mit Nr, Ziffer, Bezeichnung, Faktor, Betrag, Quelle ausgeben. Danach kurz erklären, welche Angaben für PDF und PAD/DAT noch fehlen.",
                )
              }
            >
              TXT vorbereiten
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() =>
                onVorschlagComposer(
                  "Bitte die genannten GOÄ-Positionen so strukturieren, dass ich daraus eine Rechnungs-PDF (Kopfzeile, Patient optional, Summen) erzeugen kann. Liste fehlende Stammdaten auf.",
                )
              }
            >
              PDF vorbereiten
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() =>
                onVorschlagComposer(
                  "Bitte die genannten Positionen im PAD/DAT-Stil (Referenz PV880441-1.DAT: feste Zeilenlänge, PAD-DATEN-Kopf, Windows-1252) als Entwurf beschreiben oder Zeilen generieren.",
                )
              }
            >
              PAD/DAT
            </Button>
          </div>
        </section>
      ) : null}
      {data.vorschlaege && data.vorschlaege.length > 0 ? (
        <section className="pt-1 border-t border-border/30 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Vorschläge
          </h3>
          <ul className="space-y-2 list-none p-0 m-0">
            {data.vorschlaege.map((v) => {
              const st = effectiveVorschlagStatus?.[v.id];
              if (st === "rejected") return null;
              if (st === "accepted") {
                return (
                  <li
                    key={v.id}
                    className="text-xs text-muted-foreground rounded-md border border-border/50 bg-muted/20 px-3 py-2"
                  >
                    <span className="line-through opacity-70">{v.text}</span>
                    <span className="block mt-1 font-medium text-foreground/80">Übernommen in die Eingabe</span>
                  </li>
                );
              }
              return (
                <li
                  key={v.id}
                  className="rounded-md border border-border/60 bg-card/80 px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2"
                >
                  <p className="text-sm text-foreground flex-1 min-w-0 leading-snug">{v.text}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => {
                        onVorschlagComposer?.(v.text);
                        persistVorschlagStatus(v.id, "accepted");
                      }}
                    >
                      Annehmen
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => persistVorschlagStatus(v.id, "rejected")}
                    >
                      Ablehnen
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function chatBubbleUserInitials(user: SupabaseUser): string {
  const name = displayNameFromUser(user);
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  const email = user.email;
  if (!email) return "?";
  const part = email.split("@")[0];
  if (part.length >= 2) return part.slice(0, 2).toUpperCase();
  return part.slice(0, 1).toUpperCase();
}

const ChatBubble = ({
  message,
  conversationId,
  updateMessageStructuredContent,
  invoiceReviewSourcePdf = null,
  feedbackSessionMeta,
  feedbackPriorMessages,
  onKurzantwortVorschlagComposer,
  onResumeEngine3WithCaseGroups,
  begruendungRegenerateContext,
}: ChatBubbleProps) => {
  const isUser = message.role === "user";
  const { user: authUser } = useAuth();
  const userAvatarUrl = authUser?.user_metadata?.avatar_url as string | undefined;
  const [overlayFile, setOverlayFile] = useState<{
    src?: string;
    name: string;
    type: string;
  } | null>(null);
  const [feedbackState, setFeedbackState] = useState<"none" | "positive" | "negative">("none");
  const [feedbackJustSaved, setFeedbackJustSaved] = useState<"up" | "down" | null>(null);
  const [feedbackCelebration, setFeedbackCelebration] = useState(false);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const [selectedEngine3CaseId, setSelectedEngine3CaseId] = useState<string | null>(null);
  const { toast } = useToast();
  const { sendFeedback, isExpertMode } = useFeedback();
  const clearFeedbackCelebration = useCallback(() => setFeedbackCelebration(false), []);

  useEffect(() => {
    if (!feedbackJustSaved) return;
    const id = window.setTimeout(() => setFeedbackJustSaved(null), 500);
    return () => window.clearTimeout(id);
  }, [feedbackJustSaved]);
  const invoiceDecisionsRef = useRef<Record<string, string>>({});
  const serviceDecisionsRef = useRef<Record<string, string>>({});

  const handleInvoiceDecisionsForFeedback = useCallback((d: Record<string, SuggestionDecision>) => {
    invoiceDecisionsRef.current = Object.fromEntries(
      Object.entries(d).map(([k, v]) => [k, v]),
    );
  }, []);

  const handleServiceDecisionsForFeedback = useCallback((d: Record<string, string>) => {
    serviceDecisionsRef.current = d;
  }, []);

  const handlePersistInvoice = useCallback(
    (d: Record<string, SuggestionDecision>) => {
      if (!updateMessageStructuredContent) return;
      void updateMessageStructuredContent(message.id, {
        suggestionDecisions: {
          invoice: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v])),
        },
      });
    },
    [message.id, updateMessageStructuredContent],
  );

  const handlePersistService = useCallback(
    (d: Record<string, "pending" | "accepted" | "rejected">) => {
      if (!updateMessageStructuredContent) return;
      void updateMessageStructuredContent(message.id, {
        suggestionDecisions: {
          service: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v])),
        },
      });
    },
    [message.id, updateMessageStructuredContent],
  );

  const submitFeedback = useCallback(
    async (rating: 1 | -1, inquiryReason?: "A" | "B" | "C" | null) => {
      // #region agent log
      if (!conversationId || !message.id) {
        fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79522a" },
          body: JSON.stringify({
            sessionId: "79522a",
            runId: "pre-fix",
            hypothesisId: "H3",
            location: "ChatBubble.tsx:submitFeedback",
            message: "submit_aborted_missing_ids",
            data: { hasConversationId: Boolean(conversationId), hasMessageId: Boolean(message.id), rating },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        return;
      }
      // #endregion
      setIsSendingFeedback(true);
      const rl_context = buildRlFeedbackContext(message, feedbackSessionMeta, feedbackPriorMessages);
      const result = await sendFeedback({
        message_id: message.id,
        conversation_id: conversationId,
        response_content: assistantMessageFeedbackBody(message),
        rating,
        metadata: {
          decisions: { ...invoiceDecisionsRef.current, ...serviceDecisionsRef.current },
          inquiry_reason: inquiryReason ?? null,
        },
        rl_context,
      });
      setIsSendingFeedback(false);
      // #region agent log
      fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79522a" },
        body: JSON.stringify({
          sessionId: "79522a",
          runId: "pre-fix",
          hypothesisId: "H4",
          location: "ChatBubble.tsx:submitFeedback:afterSend",
          message: "sendFeedback_result",
          data: { ok: result.ok, rating },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      if (result.ok) {
        setFeedbackState(rating === 1 ? "positive" : "negative");
        setFeedbackJustSaved(rating === 1 ? "up" : "down");
        setFeedbackCelebration(true);
      } else if (result.ok === false) {
        const err = result.error;
        toast({
          title: "Feedback nicht gespeichert",
          description:
            err.length > 200
              ? `${err.slice(0, 200)}…`
              : `${err} Bei anhaltenden Problemen bitte später erneut versuchen oder den Support informieren.`,
          variant: "destructive",
        });
      }
    },
    [
      conversationId,
      message,
      sendFeedback,
      feedbackSessionMeta,
      feedbackPriorMessages,
      toast,
    ]
  );

  const handleThumbsUp = useCallback(() => {
    // #region agent log
    fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79522a" },
      body: JSON.stringify({
        sessionId: "79522a",
        runId: "pre-fix",
        hypothesisId: "H2",
        location: "ChatBubble.tsx:handleThumbsUp",
        message: "thumbs_up_click",
        data: { feedbackState, willSkip: feedbackState !== "none" },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (feedbackState !== "none") return;
    submitFeedback(1);
  }, [feedbackState, submitFeedback]);

  const handleThumbsDown = useCallback(() => {
    // #region agent log
    const expert = isExpertMode();
    fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79522a" },
      body: JSON.stringify({
        sessionId: "79522a",
        runId: "pre-fix",
        hypothesisId: "H5",
        location: "ChatBubble.tsx:handleThumbsDown",
        message: "thumbs_down_click",
        data: { feedbackState, expert, willOpenInquiry: !expert && feedbackState === "none" },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (feedbackState !== "none") return;
    if (expert) {
      submitFeedback(-1);
    } else {
      setInquiryOpen(true);
    }
  }, [feedbackState, isExpertMode, submitFeedback]);

  const handleInquiryChoice = useCallback(
    (reason: "A" | "B" | "C") => {
      submitFeedback(-1, reason);
      setInquiryOpen(false);
    },
    [submitFeedback]
  );

  const handleInquirySkip = useCallback(() => {
    submitFeedback(-1);
    setInquiryOpen(false);
  }, [submitFeedback]);

  const handleExportSuccess = useCallback(() => {
    if (feedbackState === "none" && conversationId && message.id) {
      submitFeedback(1);
    }
  }, [feedbackState, conversationId, message.id, submitFeedback]);

  const engine3BulkCases: BulkReviewCase[] = useMemo(() => {
    const list = message.engine3Cases;
    if (!list?.length) return [];
    return list.map((c) => {
      let issues = 0;
      for (const p of c.result.positionen) {
        if (p.status === "warnung" || p.status === "fehler") issues += 1;
      }
      for (const p of c.result.optimierungen ?? []) {
        if (p.status === "warnung" || p.status === "fehler") issues += 1;
      }
      const count =
        c.result.positionen.length + (c.result.optimierungen?.length ?? 0);
      return {
        id: c.caseId,
        title: c.title,
        count,
        issueCount: issues,
      };
    });
  }, [message.engine3Cases]);

  const activeMultiEngine3Case =
    message.engine3Cases && message.engine3Cases.length > 1
      ? message.engine3Cases.find((c) => c.caseId === selectedEngine3CaseId) ?? message.engine3Cases[0]!
      : null;

  useEffect(() => {
    const list = message.engine3Cases;
    if (list && list.length > 1) {
      setSelectedEngine3CaseId((prev) =>
        prev && list.some((c) => c.caseId === prev) ? prev : list[0].caseId,
      );
    } else {
      setSelectedEngine3CaseId(null);
    }
  }, [message.engine3Cases]);

  const hasAssistantSubstance =
    Boolean(message.content?.trim()) ||
    message.invoiceResult != null ||
    message.serviceBillingResult != null ||
    message.engine3Result != null ||
    (message.engine3Cases != null && message.engine3Cases.length > 0) ||
    message.engine3SegmentationProposal != null ||
    message.frageAnswer != null ||
    message.docbillAnalyse != null;
  const showFeedback = !isUser && conversationId && message.id && hasAssistantSubstance;

  /** Spec 07 §11: ein KI-Disclaimer am Ende der Assistant-Nachricht (Modus A/B/C, ein gesamter Turn). */
  const showAssistantKiDisclaimer = !isUser && hasAssistantSubstance;

  // #region agent log
  useEffect(() => {
    if (isUser) return;
    fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79522a" },
      body: JSON.stringify({
        sessionId: "79522a",
        runId: "pre-fix",
        hypothesisId: "H1",
        location: "ChatBubble.tsx:feedback-visibility",
        message: "assistant_feedback_row_state",
        data: {
          showFeedback,
          hasAssistantSubstance,
          hasConversationId: Boolean(conversationId),
          messageIdLen: message.id?.length ?? 0,
          hasContent: Boolean(message.content?.trim()),
          hasInvoice: message.invoiceResult != null,
          hasService: message.serviceBillingResult != null,
          hasEngine3: message.engine3Result != null,
          hasFrage: message.frageAnswer != null,
          feedbackState,
          isSendingFeedback,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }, [
    isUser,
    showFeedback,
    hasAssistantSubstance,
    conversationId,
    message.id,
    message.content,
    message.invoiceResult,
    message.serviceBillingResult,
    message.engine3Result,
    message.frageAnswer,
    feedbackState,
    isSendingFeedback,
  ]);
  // #endregion

  return (
    <div
      className={cn(
        "flex gap-3 animate-fade-in",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {overlayFile && (
        <FileOverlay
          src={overlayFile.src}
          name={overlayFile.name}
          type={overlayFile.type}
          onClose={() => setOverlayFile(null)}
        />
      )}

      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full overflow-hidden mt-1">
          <img src={DocBillLogo} alt="DocBill" className="w-8 h-8" />
        </div>
      )}

      <div
        className={cn(
          "flex flex-col gap-1 min-w-0",
          isUser ? "max-w-[85%] sm:max-w-[75%] items-end" : "max-w-[95%] sm:max-w-[90%]"
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm leading-relaxed",
            isUser
              ? "bg-chat-user text-chat-user-foreground border border-border/80 rounded-br-md"
              : "chat-bubble-assistant rounded-bl-md"
          )}
        >
        {message.attachments?.map((att) => {
          const isPdf = att.type === "application/pdf" || att.name.toLowerCase().endsWith(".pdf");
          const isImage = att.type.startsWith("image/") || /\.(jpe?g|png|gif|bmp|tiff?|heic)$/i.test(att.name);
          const hasPreview = att.previewUrl && (isImage || isPdf);

          return (
            <div
              key={att.name}
              className={cn(
                "mb-2 rounded-md overflow-hidden cursor-pointer group/att",
                isUser ? "bg-primary-foreground/10" : "bg-muted"
              )}
              onClick={() =>
                hasPreview &&
                setOverlayFile({
                  src: att.previewUrl,
                  name: att.name,
                  type: att.type,
                })
              }
            >
              {isImage && att.previewUrl ? (
                <div className="relative">
                  <img
                    src={att.previewUrl}
                    alt={att.name}
                    className="max-w-[200px] max-h-[200px] object-contain rounded-md transition-opacity group-hover/att:opacity-80"
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-opacity">
                    <div className="bg-black/50 rounded-full p-2">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                      </svg>
                    </div>
                  </div>
                </div>
              ) : isPdf && att.previewUrl ? (
                <div className="flex items-center gap-2 text-xs px-2.5 py-2.5 hover:bg-muted/80 transition-colors">
                  <FileText className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <span className="truncate flex-1">{att.name}</span>
                  <span className="text-[10px] text-muted-foreground">PDF · Klick zum Öffnen</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 hover:bg-muted/80 transition-colors">
                  <FileText className="w-3.5 h-3.5" />
                  <span className="truncate">{att.name}</span>
                </div>
              )}
            </div>
          );
        })}

        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="space-y-4">
            {message.docbillAnalyse && <DocbillAnalysePanel data={message.docbillAnalyse} />}
            {message.invoiceResult && (
              <div className="space-y-3">
                {invoiceReviewSourcePdf ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Ihre Rechnung (Original):{" "}
                      <span className="text-foreground font-normal">{invoiceReviewSourcePdf.name}</span>
                    </p>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline shrink-0"
                      onClick={() =>
                        setOverlayFile({
                          src: invoiceReviewSourcePdf.previewUrl,
                          name: invoiceReviewSourcePdf.name,
                          type: "application/pdf",
                        })
                      }
                    >
                      <FileText className="w-3.5 h-3.5" />
                      PDF anzeigen
                    </button>
                  </div>
                ) : null}
                <InvoiceResult
                  data={message.invoiceResult}
                  onDecisionsChange={handleInvoiceDecisionsForFeedback}
                  onExportSuccess={handleExportSuccess}
                  messageId={message.id}
                  initialInvoiceDecisions={message.suggestionDecisions?.invoice ?? null}
                  onPersistInvoiceDecisions={
                    updateMessageStructuredContent ? handlePersistInvoice : undefined
                  }
                />
              </div>
            )}
            {message.serviceBillingResult && (
              <ServiceBillingResult
                data={message.serviceBillingResult}
                messageId={message.id}
                initialServiceDecisions={message.suggestionDecisions?.service ?? null}
                onDecisionsChange={handleServiceDecisionsForFeedback}
                onPersistServiceDecisions={
                  updateMessageStructuredContent ? handlePersistService : undefined
                }
                updateMessageStructuredContent={updateMessageStructuredContent}
                initialServiceBegruendungText={message.serviceBegruendungText ?? null}
              />
            )}
            {message.engine3SegmentationProposal &&
              conversationId &&
              onResumeEngine3WithCaseGroups && (
                <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20 px-3 py-3 space-y-3 not-prose">
                  <p className="text-sm font-medium text-foreground">
                    Mehrere PDFs: bitte Vorgänge bestätigen
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Konfidenz {(message.engine3SegmentationProposal.confidence * 100).toFixed(0)} %. Sie können den
                    Vorschlag übernehmen oder jede Datei einzeln prüfen lassen.
                  </p>
                  <ul className="text-xs space-y-1 list-disc pl-4">
                    {message.engine3SegmentationProposal.fileNames.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        onResumeEngine3WithCaseGroups(
                          conversationId,
                          message.engine3SegmentationProposal!.cases.map((c) => c.fileIndices),
                        )
                      }
                    >
                      Vorschlag übernehmen
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onResumeEngine3WithCaseGroups(
                          conversationId,
                          message.engine3SegmentationProposal!.fileNames.map((_, i) => [i]),
                        )
                      }
                    >
                      Jede Datei einzeln
                    </Button>
                  </div>
                </div>
              )}
            {message.engine3Cases && message.engine3Cases.length > 1 && activeMultiEngine3Case && (
              <div className="space-y-3 not-prose">
                <BulkReviewQueue
                  cases={engine3BulkCases}
                  selectedId={selectedEngine3CaseId}
                  onSelect={setSelectedEngine3CaseId}
                />
                <Engine3Result
                  key={activeMultiEngine3Case.caseId}
                  data={activeMultiEngine3Case.result}
                  messageId={message.id}
                  updateMessageStructuredContent={updateMessageStructuredContent}
                  onComposerPrompt={onKurzantwortVorschlagComposer}
                  initialEngine3Decisions={message.suggestionDecisions?.engine3 ?? null}
                  initialEngine3FaktorOverrides={message.engine3FaktorOverrides ?? null}
                  initialEngine3BegruendungText={message.engine3BegruendungText ?? null}
                  decisionKeyPrefix={`${activeMultiEngine3Case.caseId}:`}
                  begruendungRegenerateContext={begruendungRegenerateContext}
                />
              </div>
            )}
            {message.engine3Cases?.length === 1 && (
              <Engine3Result
                data={message.engine3Cases[0].result}
                messageId={message.id}
                updateMessageStructuredContent={updateMessageStructuredContent}
                onComposerPrompt={onKurzantwortVorschlagComposer}
                initialEngine3Decisions={message.suggestionDecisions?.engine3 ?? null}
                initialEngine3FaktorOverrides={message.engine3FaktorOverrides ?? null}
                initialEngine3BegruendungText={message.engine3BegruendungText ?? null}
                decisionKeyPrefix={`${message.engine3Cases[0].caseId}:`}
                begruendungRegenerateContext={begruendungRegenerateContext}
              />
            )}
            {message.engine3Result && !message.engine3Cases?.length && (
              <Engine3Result
                data={message.engine3Result}
                messageId={message.id}
                updateMessageStructuredContent={updateMessageStructuredContent}
                onComposerPrompt={onKurzantwortVorschlagComposer}
                initialEngine3Decisions={message.suggestionDecisions?.engine3 ?? null}
                initialEngine3FaktorOverrides={message.engine3FaktorOverrides ?? null}
                initialEngine3BegruendungText={message.engine3BegruendungText ?? null}
                begruendungRegenerateContext={begruendungRegenerateContext}
              />
            )}
            {message.frageAnswer && (
              <FrageStructuredReply
                data={message.frageAnswer}
                vorschlagStatus={message.kurzantwortenVorschlagStatus}
                messageId={message.id}
                updateMessageStructuredContent={updateMessageStructuredContent}
                onVorschlagComposer={onKurzantwortVorschlagComposer}
              />
            )}
            {(() => {
              if (message.frageAnswer) return null;
              const proseTrim = message.content?.trim() ?? "";
              if (!proseTrim) return null;

              const hasStructuredCard = Boolean(
                message.invoiceResult ||
                  message.serviceBillingResult ||
                  message.engine3Result ||
                  (message.engine3Cases != null && message.engine3Cases.length > 0) ||
                  message.docbillAnalyse,
              );

              if (hasStructuredCard) {
                return null;
              }

              return (
                <div className="markdown-output prose prose-sm max-w-none pt-1">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {message.content}
                  </ReactMarkdown>
                </div>
              );
            })()}
            {showAssistantKiDisclaimer && (
              <DocbillKiDisclaimerFooter className="not-prose" />
            )}
          </div>
        )}
        </div>

        {(showFeedback || (!isUser && message.analysisTimeSeconds != null)) && (
          <div className="flex items-center justify-between w-full">
            {showFeedback ? (
            <div className="relative flex items-center gap-1">
            <FeedbackThanksBurst
              show={feedbackCelebration}
              onComplete={clearFeedbackCelebration}
            />
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 text-muted-foreground hover:text-foreground",
                feedbackState === "positive" && "text-emerald-600 dark:text-emerald-400",
                feedbackJustSaved === "up" && "animate-thumb-success"
              )}
              onClick={handleThumbsUp}
              disabled={isSendingFeedback || feedbackState !== "none"}
              title="Positives Feedback"
            >
              <ThumbsUp className="w-4 h-4" />
            </Button>
            <Popover open={inquiryOpen} onOpenChange={setInquiryOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8 text-muted-foreground hover:text-foreground",
                    feedbackState === "negative" && "text-red-600 dark:text-red-400",
                    feedbackJustSaved === "down" && "animate-thumb-success"
                  )}
                  onClick={handleThumbsDown}
                  disabled={isSendingFeedback || feedbackState !== "none"}
                  title="Negatives Feedback"
                >
                  <ThumbsDown className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3" align="start">
                <p className="text-sm font-medium mb-2">Was war nicht korrekt?</p>
                <div className="space-y-1">
                  <button
                    type="button"
                    className="block w-full text-left text-sm py-1.5 px-2 rounded hover:bg-muted"
                    onClick={() => handleInquiryChoice("A")}
                  >
                    (A) Fehlende Daten
                  </button>
                  <button
                    type="button"
                    className="block w-full text-left text-sm py-1.5 px-2 rounded hover:bg-muted"
                    onClick={() => handleInquiryChoice("B")}
                  >
                    (B) Falsche Berechnung
                  </button>
                  <button
                    type="button"
                    className="block w-full text-left text-sm py-1.5 px-2 rounded hover:bg-muted"
                    onClick={() => handleInquiryChoice("C")}
                  >
                    (C) Formfehler
                  </button>
                </div>
                <button
                  type="button"
                  className="mt-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={handleInquirySkip}
                >
                  Überspringen
                </button>
              </PopoverContent>
            </Popover>
          </div>
            ) : <div className="flex-1" />}
            {!isUser && message.analysisTimeSeconds != null && (
              <span className="text-[10px] text-muted-foreground">
                {message.analysisTimeSeconds.toFixed(1).replace(".", ",")} s
              </span>
            )}
          </div>
        )}
      </div>

      {isUser && (
        <div className="flex-shrink-0 mt-1">
          <Avatar className="h-8 w-8 shrink-0 ring-2 ring-background">
            <AvatarImage src={userAvatarUrl} alt="" />
            <AvatarFallback className="text-[10px] leading-none bg-primary text-primary-foreground">
              {authUser ? chatBubbleUserInitials(authUser) : "?"}
            </AvatarFallback>
          </Avatar>
        </div>
      )}

    </div>
  );
};

export default ChatBubble;
