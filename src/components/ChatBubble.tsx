import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { User, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import DocBillLogo from "@/assets/DocBill-Logo.svg";
import InvoiceResult, { type InvoiceResultData } from "@/components/InvoiceResult";
import FileOverlay from "@/components/FileOverlay";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: { name: string; type: string; previewUrl?: string }[];
  invoiceResult?: InvoiceResultData;
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

const ChatBubble = ({ message }: { message: ChatMessage }) => {
  const isUser = message.role === "user";
  const [overlayFile, setOverlayFile] = useState<{
    src?: string;
    name: string;
    type: string;
  } | null>(null);

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
          "rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "max-w-[85%] sm:max-w-[75%] bg-chat-user text-chat-user-foreground rounded-br-md"
            : "max-w-[95%] sm:max-w-[90%] chat-bubble-assistant rounded-bl-md"
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
              <InvoiceResult data={message.invoiceResult} />
            )}
            {message.content && (
              <div className="markdown-output prose prose-sm max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
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
