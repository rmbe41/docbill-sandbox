import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { User, Bot, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: { name: string; type: string; previewUrl?: string }[];
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
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center mt-1">
          <Bot className="w-4 h-4 text-accent-foreground" />
        </div>
      )}

      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-chat-user text-chat-user-foreground rounded-br-md"
            : "chat-bubble-assistant rounded-bl-md"
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
          <div className="prose prose-sm max-w-none
            prose-headings:text-foreground prose-headings:font-semibold
            prose-h2:text-base prose-h2:mt-5 prose-h2:mb-3 prose-h2:pb-1.5 prose-h2:border-b prose-h2:border-border
            prose-h3:text-sm prose-h3:mt-4 prose-h3:mb-2
            prose-p:text-chat-assistant-foreground prose-p:my-1.5 prose-p:leading-relaxed
            prose-strong:text-foreground prose-strong:font-semibold
            prose-code:text-accent prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-xs prose-code:font-mono
            prose-table:text-xs prose-table:my-3 prose-table:w-full
            prose-th:bg-muted prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:text-foreground prose-th:text-xs prose-th:uppercase prose-th:tracking-wider
            prose-td:px-3 prose-td:py-2 prose-td:border-t prose-td:border-border prose-td:align-top
            prose-hr:my-4 prose-hr:border-border/60
            prose-li:my-0.5 prose-li:leading-relaxed
            prose-ul:my-2 prose-ul:space-y-1
            prose-ol:my-2
            prose-blockquote:border-l-accent prose-blockquote:bg-muted/50 prose-blockquote:rounded-r-md prose-blockquote:py-1 prose-blockquote:px-3 prose-blockquote:my-3
            [&_table]:rounded-lg [&_table]:overflow-hidden [&_table]:border [&_table]:border-border
            [&_thead]:bg-muted/80
            [&_tbody_tr:hover]:bg-muted/30 [&_tbody_tr]:transition-colors">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
