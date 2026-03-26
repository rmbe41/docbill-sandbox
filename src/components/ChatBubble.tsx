import React, { useState, useCallback, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { FileText, ThumbsUp, ThumbsDown, ChevronDown } from "lucide-react";
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
import FileOverlay from "@/components/FileOverlay";
import { useFeedback, type RlFeedbackContext } from "@/hooks/useFeedback";
import { useToast } from "@/hooks/use-toast";
import { FeedbackThanksBurst } from "@/components/FeedbackThanksBurst";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { MessageStructuredContentV1 } from "@/lib/messageStructuredContent";
import type { FrageAnswerStructured } from "@/lib/frageAnswerStructured";
import { filterExplicitQuellenEntries } from "@/lib/quellenMetaFilter";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: { name: string; type: string; previewUrl?: string }[];
  invoiceResult?: InvoiceResultData;
  serviceBillingResult?: ServiceBillingResultData;
  engine3Result?: Engine3ResultData;
  analysisTimeSeconds?: number;
  frageAnswer?: FrageAnswerStructured;
  suggestionDecisions?: {
    invoice?: Record<string, string>;
    service?: Record<string, string>;
  };
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
    message.frageAnswer != null;
  const structured_snapshot = hasStructured
    ? {
        ...(message.invoiceResult ? { invoiceResult: message.invoiceResult } : {}),
        ...(message.serviceBillingResult ? { serviceBillingResult: message.serviceBillingResult } : {}),
        ...(message.engine3Result ? { engine3Result: message.engine3Result } : {}),
        ...(message.frageAnswer ? { frageAnswer: message.frageAnswer } : {}),
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
  if (m.engine3Result) return "[DocBill: Engine 3 strukturiert]";
  return "";
}

// Custom markdown components – flache Typografie, keine Boxen
const markdownComponents = {
  h2: ({ children, ...props }: any) => (
    <h2 className="font-semibold mt-6 mb-2 first:mt-0" {...props}>
      {children}
    </h2>
  ),
  hr: (props: any) => <hr className="section-divider" {...props} />,
  table: ({ children, ...props }: any) => (
    <div className="overflow-x-auto my-4">
      <table {...props}>{children}</table>
    </div>
  ),
};

/** Frage-Structured: keine großen Überschriften in Unterfeldern (Prompt verbietet ###); falls doch, wie Absatz. */
const frageSectionMarkdownComponents = {
  ...markdownComponents,
  h1: ({ children, ...props }: any) => (
    <p className="font-semibold my-1.5 first:mt-0 text-sm" {...props}>
      {children}
    </p>
  ),
  h2: ({ children, ...props }: any) => (
    <p className="font-semibold my-1.5 first:mt-0 text-sm" {...props}>
      {children}
    </p>
  ),
  h3: ({ children, ...props }: any) => (
    <p className="font-semibold my-1.5 first:mt-0 text-sm" {...props}>
      {children}
    </p>
  ),
  h4: ({ children, ...props }: any) => (
    <p className="font-semibold my-1.5 first:mt-0 text-sm" {...props}>
      {children}
    </p>
  ),
  h5: ({ children, ...props }: any) => (
    <p className="font-semibold my-1.5 first:mt-0 text-sm" {...props}>
      {children}
    </p>
  ),
  h6: ({ children, ...props }: any) => (
    <p className="font-semibold my-1.5 first:mt-0 text-sm" {...props}>
      {children}
    </p>
  ),
};

function displayNameFromUser(user: SupabaseUser): string | null {
  const m = user.user_metadata ?? {};
  const n =
    (m.full_name as string | undefined)?.trim() ||
    (m.display_name as string | undefined)?.trim() ||
    (m.name as string | undefined)?.trim();
  return n || null;
}

function FrageStructuredReply({ data }: { data: FrageAnswerStructured }) {
  const quellen = filterExplicitQuellenEntries(data.quellen?.filter(Boolean) ?? []);
  return (
    <div className="space-y-4 not-prose text-foreground">
      <section className="rounded-lg border border-border/80 bg-muted/30 px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
          Kurzantwort
        </h3>
        <div className="markdown-output prose prose-sm max-w-none text-sm leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={frageSectionMarkdownComponents}>
            {data.kurzantwort}
          </ReactMarkdown>
        </div>
      </section>
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
          Erläuterung
        </h3>
        <div className="markdown-output prose prose-sm max-w-none text-sm leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={frageSectionMarkdownComponents}>
            {data.erlaeuterung}
          </ReactMarkdown>
        </div>
      </section>
      {data.grenzfaelle_hinweise?.trim() ? (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            Grenzfälle und Hinweise
          </h3>
          <div className="markdown-output prose prose-sm max-w-none text-sm leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={frageSectionMarkdownComponents}>
              {data.grenzfaelle_hinweise}
            </ReactMarkdown>
          </div>
        </section>
      ) : null}
      {quellen.length > 0 ? (
        <footer className="mt-1 pt-3 border-t border-border/30">
          <p className="text-xs leading-relaxed text-muted-foreground break-words">
            <span className="font-bold">Quellen:</span> {quellen.join(", ")}
          </p>
        </footer>
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
      } else {
        toast({
          title: "Feedback nicht gespeichert",
          description:
            result.error.length > 200
              ? `${result.error.slice(0, 200)}…`
              : `${result.error} Bei anhaltenden Problemen bitte später erneut versuchen oder den Support informieren.`,
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

  const hasAssistantSubstance =
    Boolean(message.content?.trim()) ||
    message.invoiceResult != null ||
    message.serviceBillingResult != null ||
    message.engine3Result != null ||
    message.frageAnswer != null;
  const showFeedback = !isUser && conversationId && message.id && hasAssistantSubstance;

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
              />
            )}
            {message.engine3Result && <Engine3Result data={message.engine3Result} />}
            {message.frageAnswer && <FrageStructuredReply data={message.frageAnswer} />}
            {(message.content ||
              (message.invoiceResult && !message.content) ||
              (message.serviceBillingResult && !message.content) ||
              (message.engine3Result && !message.content)) &&
              !message.frageAnswer &&
              (message.invoiceResult && message.content ? (
                <Collapsible defaultOpen={false} className="group not-prose border-t border-border/30 mt-2 pt-1">
                  <CollapsibleTrigger className="flex w-full items-center gap-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground py-2 rounded-md -mx-1 px-1">
                    <ChevronDown className="w-4 h-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                    Ausführliche Begründung anzeigen (z. B. § 5 GOÄ, Audit-Text)
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="markdown-output prose prose-sm max-w-none pb-2 border-border/20">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ) : (
                <div className="markdown-output prose prose-sm max-w-none pt-1">
                  {(message.invoiceResult || message.serviceBillingResult || message.engine3Result) &&
                    message.content && (
                    <p className="text-xs font-medium text-muted-foreground not-prose mb-2">
                      Detaillierte Erklärung
                    </p>
                  )}
                  {message.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {message.content}
                    </ReactMarkdown>
                  ) : (
                    <p className="text-muted-foreground text-sm not-prose">
                      Die detaillierte Erklärung konnte nicht geladen werden (z. B. Timeout). Die Prüfung
                      oben ist vollständig – bei Bedarf die Anfrage erneut senden.
                    </p>
                  )}
                </div>
              ))}
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
