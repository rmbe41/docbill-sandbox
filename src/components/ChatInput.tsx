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
      {/* Soft glow on focus-within */}
      <div className="absolute -inset-2 rounded-[28px] bg-foreground/5 blur-2xl opacity-0 group-focus-within:opacity-60 transition-opacity duration-500" />
      <div
        className="relative bg-white/15 dark:bg-card/10 backdrop-blur-2xl backdrop-saturate-200 border border-white/30 dark:border-white/10 rounded-2xl shadow-[0_8px_32px_-8px_rgba(0,0,0,0.08),inset_0_0_0_1px_rgba(255,255,255,0.12)] px-3 py-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleFileDrop}
      >
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {files.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 bg-muted text-xs px-2 py-0.5 rounded-md"
            >
              <span className="truncate max-w-[150px]">{file.name}</span>
              <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors mb-0.5"
          title="Datei hochladen (PDF, JPEG, PNG, HEIC)"
        >
          <Paperclip className="w-4 h-4" />
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
            "flex-1 resize-none bg-transparent rounded-xl px-3 py-2 text-xs",
            "placeholder:text-muted-foreground focus:outline-none",
            "min-h-[32px] max-h-[160px]"
          )}
        />

        <Button
          onClick={handleSubmit}
          disabled={isLoading || (!input.trim() && files.length === 0)}
          size="icon"
          className="flex-shrink-0 rounded-xl h-8 w-8 mb-0.5"
        >
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>

      <p className="text-[9px] text-muted-foreground mt-1.5 text-center">
        PDF, JPEG, PNG oder HEIC per Drag & Drop oder Klammer-Symbol hochladen
      </p>
    </div>
    </div>
  );
};

export default ChatInput;
