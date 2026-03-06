import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { User, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import DocBillLogo from "@/assets/DocBill-Logo.svg";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: { name: string; type: string; previewUrl?: string }[];
};

// Detect emoji at start of heading text for section-card coloring
const getEmojiStyle = (text: string): string | null => {
  if (text.startsWith("📋")) return "section-card section-card-info";
  if (text.startsWith("✅")) return "section-card section-card-success";
  if (text.startsWith("⚠️")) return "section-card section-card-warning";
  if (text.startsWith("💡")) return "section-card section-card-accent";
  if (text.startsWith("📝")) return "section-card section-card-neutral";
  return null;
};

const extractText = (children: React.ReactNode): string => {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (React.isValidElement(children) && children.props?.children)
    return extractText(children.props.children);
  return "";
};

// Custom markdown components for styled sections
const markdownComponents = {
  h2: ({ children, ...props }: any) => {
    const text = extractText(children);
    const cardClass = getEmojiStyle(text);
    if (cardClass) {
      return (
        <h2 className={cardClass} {...props}>
          {children}
        </h2>
      );
    }
    return <h2 {...props}>{children}</h2>;
  },
  hr: (props: any) => <hr className="section-divider" {...props} />,
  table: ({ children, ...props }: any) => (
    <div className="table-scroll-wrapper">
      <table {...props}>{children}</table>
    </div>
  ),
};

const ChatBubble = ({ message }: { message: ChatMessage }) => {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex gap-3 animate-fade-in",
        isUser ? "justify-end" : "justify-start"
      )}
    >
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
        {message.attachments?.map((att) => (
          <div
            key={att.name}
            className={cn(
              "mb-2 rounded-md overflow-hidden",
              isUser ? "bg-primary-foreground/10" : "bg-muted"
            )}
          >
            {att.previewUrl ? (
              <img src={att.previewUrl} alt={att.name} className="max-w-[200px] max-h-[200px] object-contain rounded-md" />
            ) : (
              <div className="flex items-center gap-2 text-xs px-2.5 py-1.5">
                <FileText className="w-3.5 h-3.5" />
                <span className="truncate">{att.name}</span>
              </div>
            )}
          </div>
        ))}

        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
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

      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center mt-1">
          <User className="w-4 h-4 text-primary-foreground" />
        </div>
      )}
    </div>
  );
};

export default ChatBubble;
