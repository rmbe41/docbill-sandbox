import { useState, useRef, useCallback } from "react";
import { Send, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ChatInputProps = {
  onSend: (message: string, files?: File[]) => void;
  isLoading: boolean;
};

const ChatInput = ({ onSend, isLoading }: ChatInputProps) => {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed && files.length === 0) return;
    onSend(trimmed, files.length > 0 ? files : undefined);
    setInput("");
    setFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/heic"];
    const dropped = Array.from(e.dataTransfer.files).filter(
      (f) => ALLOWED.includes(f.type) || /\.(jpe?g|png|heic|pdf)$/i.test(f.name)
    );
    if (dropped.length > 0) setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...selected]);
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="relative group">
      {/* Subtle glow */}
      <div className="absolute -inset-2 rounded-2xl bg-accent/8 blur-xl" />
      <div
        className="relative bg-card border border-border rounded-xl shadow-sm px-4 py-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleFileDrop}
      >
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 px-2">
          {files.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 bg-muted text-xs sm:text-sm px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full"
            >
              <span className="truncate max-w-[150px]">{file.name}</span>
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
          title="Datei hochladen (PDF, JPEG, PNG, HEIC)"
        >
          <Paperclip className="w-5 h-5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.heic"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          placeholder="Beschreiben Sie die erbrachten Leistungen oder stellen Sie eine Frage zur GOÄ…"
          rows={1}
          className={cn(
            "flex-1 resize-none bg-transparent px-2 py-2 text-base sm:text-lg",
            "placeholder:text-muted-foreground/70 focus:outline-none",
            "min-h-[44px] max-h-[200px]"
          )}
        />

        <Button
          onClick={handleSubmit}
          disabled={isLoading || (!input.trim() && files.length === 0)}
          size="icon"
          className="flex-shrink-0 rounded-full h-10 w-10 sm:h-11 sm:w-11"
        >
          <Send className="w-4 h-4 sm:w-5 sm:h-5" />
        </Button>
      </div>
    </div>
    </div>
  );
};

export default ChatInput;
