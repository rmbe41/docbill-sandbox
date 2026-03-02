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
          <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-headings:mt-4 prose-headings:mb-2 prose-p:text-chat-assistant-foreground prose-strong:text-foreground prose-code:text-accent prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-table:text-xs prose-th:bg-muted prose-th:px-2 prose-th:py-1.5 prose-th:text-left prose-th:font-semibold prose-td:px-2 prose-td:py-1.5 prose-td:border-t prose-td:border-border prose-hr:my-3 prose-hr:border-border prose-li:my-0.5 prose-ul:my-1">
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
