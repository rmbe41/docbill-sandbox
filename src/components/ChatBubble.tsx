import React, { useState, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { User, FileText, ThumbsUp, ThumbsDown } from "lucide-react";
import { cn } from "@/lib/utils";
import DocBillLogo from "@/assets/DocBill-Logo.svg";
import InvoiceResult, {
  type InvoiceResultData,
  type SuggestionDecision,
} from "@/components/InvoiceResult";
import ServiceBillingResult, { type ServiceBillingResultData } from "@/components/ServiceBillingResult";
import FileOverlay from "@/components/FileOverlay";
import { useFeedback } from "@/hooks/useFeedback";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { MessageStructuredContentV1 } from "@/lib/messageStructuredContent";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: { name: string; type: string; previewUrl?: string }[];
  invoiceResult?: InvoiceResultData;
  serviceBillingResult?: ServiceBillingResultData;
  analysisTimeSeconds?: number;
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
};

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

const ChatBubble = ({ message, conversationId, updateMessageStructuredContent }: ChatBubbleProps) => {
  const isUser = message.role === "user";
  const [overlayFile, setOverlayFile] = useState<{
    src?: string;
    name: string;
    type: string;
  } | null>(null);
  const [feedbackState, setFeedbackState] = useState<"none" | "positive" | "negative">("none");
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const { sendFeedback, isExpertMode } = useFeedback();
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
      if (!conversationId || !message.id) return;
      setIsSendingFeedback(true);
      const ok = await sendFeedback({
        message_id: message.id,
        conversation_id: conversationId,
        response_content: message.content,
        rating,
        metadata: {
          decisions: { ...invoiceDecisionsRef.current, ...serviceDecisionsRef.current },
          inquiry_reason: inquiryReason ?? null,
        },
      });
      setIsSendingFeedback(false);
      if (ok) setFeedbackState(rating === 1 ? "positive" : "negative");
    },
    [conversationId, message.id, message.content, sendFeedback]
  );

  const handleThumbsUp = useCallback(() => {
    if (feedbackState !== "none") return;
    submitFeedback(1);
  }, [feedbackState, submitFeedback]);

  const handleThumbsDown = useCallback(() => {
    if (feedbackState !== "none") return;
    if (isExpertMode()) {
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

  const showFeedback = !isUser && conversationId && message.id && message.content;

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
              ? "bg-chat-user text-chat-user-foreground rounded-br-md"
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
            {(message.content ||
              (message.invoiceResult && !message.content) ||
              (message.serviceBillingResult && !message.content)) && (
              <div className="markdown-output prose prose-sm max-w-none pt-1">
                {(message.invoiceResult || message.serviceBillingResult) && message.content && (
                  <p className="text-xs font-medium text-muted-foreground not-prose mb-2">Detaillierte Erklärung</p>
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
            )}
          </div>
        )}
        </div>

        {(showFeedback || (!isUser && message.analysisTimeSeconds != null)) && (
          <div className="flex items-center justify-between w-full">
            {showFeedback ? (
            <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 text-muted-foreground hover:text-foreground",
                feedbackState === "positive" && "text-emerald-600 dark:text-emerald-400"
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
                    feedbackState === "negative" && "text-red-600 dark:text-red-400"
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
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center mt-1">
          <User className="w-4 h-4 text-primary-foreground" />
        </div>
      )}

    </div>
  );
};

export default ChatBubble;
