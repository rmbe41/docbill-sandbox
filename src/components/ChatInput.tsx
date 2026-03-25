import { useRef, useCallback, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { Send, Square, Paperclip, X, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDraft } from "@/hooks/useDraft";
import FileOverlay from "@/components/FileOverlay";

type ChatInputProps = {
  onSend: (message: string, files?: File[]) => void;
  isLoading: boolean;
  onStop?: () => void;
  /** Shown in title/tooltip, e.g. "Strg+U" */
  attachmentShortcutHint?: string;
  stopShortcutHint?: string;
  /** Persist/load composer text per conversation (localStorage). */
  draftConversationId?: string | null;
};

function composerDraftStorageKey(conversationId: string | null | undefined) {
  return `docbill-composer-draft:${conversationId ?? "__none__"}`;
}

export type ChatInputHandle = {
  openAttachmentPicker: () => void;
};

/** Outer height of the composer card when there are no file chips (border + py-3 + input row with min-h-[44px]). */
export const CHAT_COMPOSER_OUTER_HEIGHT_CLASS = "h-[70px]";

/** Shared bottom dock rhythm: Index composer strip + AgentsSidebar „Neuer Chat“ footer. */
export const CHAT_COMPOSER_DOCK_BOTTOM_PAD = "pb-10";
export const CHAT_COMPOSER_DOCK_BELOW_CARD = "mt-1.5 min-h-8";
/** Same top inset on dock + sidebar footer so „Neuer Chat“ and composer tops stay aligned. */
export const CHAT_COMPOSER_DOCK_TOP_PAD = "pt-3";

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg", "image/png", "image/gif", "image/bmp", "image/tiff", "image/heic",
];

const ALLOWED_EXT = /\.(jpe?g|png|gif|bmp|tiff?|heic|pdf)$/i;

const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  { onSend, isLoading, onStop, attachmentShortcutHint, stopShortcutHint, draftConversationId = null },
  ref,
) {
  const { text, setText, files, addFiles, removeFile, clearFiles, clearDraft } = useDraft();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewFile, setPreviewFile] = useState<{ src: string; name: string; type: string } | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const prevDraftConvRef = useRef<string | null | undefined>(undefined);
  const convIdForAutosaveRef = useRef(draftConversationId);

  useImperativeHandle(ref, () => ({
    openAttachmentPicker: () => fileInputRef.current?.click(),
  }), []);

  useEffect(() => {
    const key = composerDraftStorageKey(draftConversationId);
    const prev = prevDraftConvRef.current;
    if (prev !== undefined && prev !== draftConversationId) {
      try {
        localStorage.setItem(composerDraftStorageKey(prev), textRef.current);
      } catch {
        /* quota */
      }
    }
    let loaded = "";
    try {
      loaded = localStorage.getItem(key) ?? "";
    } catch {
      loaded = "";
    }
    setText(loaded);
    clearFiles();
    prevDraftConvRef.current = draftConversationId;
    convIdForAutosaveRef.current = draftConversationId;
  }, [draftConversationId, setText, clearFiles]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(composerDraftStorageKey(convIdForAutosaveRef.current), text);
      } catch {
        /* quota */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [text]);

  // Restore textarea height when component remounts with existing text
  useEffect(() => {
    if (textareaRef.current && text) {
      const el = textareaRef.current;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  }, []);

  const handleSubmit = () => {
    if (isLoading) return;
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;
    onSend(trimmed, files.length > 0 ? files : undefined);
    try {
      localStorage.removeItem(composerDraftStorageKey(draftConversationId));
    } catch {
      /* ignore */
    }
    clearDraft();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (!e.shiftKey) {
        const el = textareaRef.current;
        if (el) {
          const start = el.selectionStart;
          const lineStart = text.slice(0, start).lastIndexOf("\n") + 1;
          const line = text.slice(lineStart, start);
          const bulletMatch = line.match(/^(\s*[-*])\s/);
          const numMatch = line.match(/^(\s*\d+)\.\s/);
          if (bulletMatch) {
            e.preventDefault();
            const prefix = bulletMatch[1] + " ";
            insertListLine(prefix);
            return;
          }
          if (numMatch) {
            e.preventDefault();
            const n = parseInt(numMatch[1], 10) + 1;
            insertListLine(numMatch[1].replace(/\d+/, String(n)) + ". ");
            return;
          }
        }
        e.preventDefault();
        handleSubmit();
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "b") {
        e.preventDefault();
        wrapWithMarkup("**", "**", "fett");
      } else if (e.key === "i") {
        e.preventDefault();
        wrapWithMarkup("*", "*", "kursiv");
      } else if (e.shiftKey && e.key === "s") {
        e.preventDefault();
        wrapWithMarkup("~~", "~~", "durchgestrichen");
      } else if (e.shiftKey && e.key === "C") {
        e.preventDefault();
        wrapWithMarkup("`", "`", "code");
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      if (e.key === "8") {
        e.preventDefault();
        insertListLine("- ");
      } else if (e.key === "7") {
        e.preventDefault();
        insertListLine("1. ");
      }
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const el = textareaRef.current;
    if (!el) return;
    const clipboardData = e.clipboardData;
    let pasted = clipboardData.getData("text/plain");
    const html = clipboardData.getData("text/html");
    if (html && (!pasted || !pasted.includes("\n"))) {
      const div = document.createElement("div");
      div.innerHTML = html;
      const fromHtml = div.innerText || div.textContent || "";
      if (fromHtml.length > pasted.length) pasted = fromHtml;
    }
    pasted = pasted.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
    if (!pasted) return;
    e.preventDefault();
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const newText = text.slice(0, start) + pasted + text.slice(end);
    setText(newText);
    const newCursor = start + pasted.length;
    setTimeout(() => {
      textareaRef.current?.setSelectionRange(newCursor, newCursor);
      textareaRef.current?.focus();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
      }
    }, 0);
  }, [text]);

  const wrapWithMarkup = useCallback((before: string, after: string, placeholder = "Text") => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = text.slice(start, end);
    const insert = selected || placeholder;
    const newText = text.slice(0, start) + before + insert + after + text.slice(end);
    setText(newText);
    el.focus();
    setTimeout(() => {
      if (!textareaRef.current) return;
      const selStart = start + before.length;
      const selEnd = selStart + insert.length;
      textareaRef.current.setSelectionRange(selStart, selEnd);
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }, 0);
  }, [text]);

  const insertListLine = useCallback((prefix: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const beforeCursor = text.slice(0, start);
    const lineStart = beforeCursor.lastIndexOf("\n") + 1;
    const isStartOfLine = lineStart === start;
    const insert = isStartOfLine ? prefix : "\n" + prefix;
    const newText = text.slice(0, start) + insert + text.slice(start);
    setText(newText);
    el.focus();
    const newCursor = start + insert.length;
    setTimeout(() => {
      textareaRef.current?.setSelectionRange(newCursor, newCursor);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
      }
    }, 0);
  }, [text]);

  const filterAllowed = (fileList: FileList | File[]): File[] =>
    Array.from(fileList).filter(
      (f) => ALLOWED_TYPES.includes(f.type) || ALLOWED_EXT.test(f.name),
    );

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dropped = filterAllowed(e.dataTransfer.files);
    if (dropped.length > 0) addFiles(dropped);
  }, [addFiles]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = filterAllowed(e.target.files || []);
    if (selected.length > 0) addFiles(selected);
    e.target.value = "";
  };

  const openPreview = (file: File) => {
    const url = URL.createObjectURL(file);
    setPreviewFile({ src: url, name: file.name, type: file.type });
  };

  const closePreview = () => {
    if (previewFile) {
      URL.revokeObjectURL(previewFile.src);
      setPreviewFile(null);
    }
  };

  return (
    <div className="relative group">
      {previewFile && (
        <FileOverlay
          src={previewFile.src}
          name={previewFile.name}
          type={previewFile.type}
          onClose={closePreview}
        />
      )}

      <div className="absolute -inset-2 rounded-2xl bg-accent/8 blur-xl" />
      <div
        className="relative bg-card border border-border rounded-xl px-4 py-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleFileDrop}
      >
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 px-2">
          {files.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="flex items-center gap-1.5 bg-muted text-xs sm:text-sm px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full group/chip"
            >
              <button
                onClick={() => openPreview(file)}
                className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                title="Vorschau öffnen"
              >
                <Eye className="w-3 h-3 opacity-0 group-hover/chip:opacity-100 transition-opacity" />
                <span className="truncate max-w-[150px]">{file.name}</span>
              </button>
              <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 sm:gap-3">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex-shrink-0 p-1.5 sm:p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          title={
            attachmentShortcutHint
              ? `Datei hochladen (PDF, JPEG, PNG, GIF, BMP, TIFF, HEIC) — ${attachmentShortcutHint}`
              : "Datei hochladen (PDF, JPEG, PNG, GIF, BMP, TIFF, HEIC)"
          }
        >
          <Paperclip className="w-5 h-5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.gif,.bmp,.tif,.tiff,.heic"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        <textarea
          ref={textareaRef}
          data-composer-chat="true"
          value={text}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Beschreiben Sie die erbrachten Leistungen oder stellen Sie eine Frage zur GOÄ…"
          rows={1}
          className={cn(
            "flex-1 resize-none bg-transparent px-2 py-2 text-sm",
            "text-muted-foreground placeholder:text-muted-foreground focus:outline-none",
            "min-h-[44px] max-h-[200px]"
          )}
        />

        {isLoading && onStop ? (
          <Button
            onClick={onStop}
            size="icon"
            variant="ghost"
            className="flex-shrink-0 rounded-full h-10 w-10 sm:h-11 sm:w-11 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            title={stopShortcutHint ? `Analyse stoppen — ${stopShortcutHint}` : "Analyse stoppen"}
            aria-label="Analyse stoppen"
          >
            <Square className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={isLoading || (!text.trim() && files.length === 0)}
            size="icon"
            className="flex-shrink-0 rounded-full h-10 w-10 sm:h-11 sm:w-11"
          >
            <Send className="w-4 h-4 sm:w-5 sm:h-5" />
          </Button>
        )}
      </div>
    </div>
    </div>
  );
});

export default ChatInput;
