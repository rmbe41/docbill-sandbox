import { useRef, useCallback, useEffect, useState } from "react";
import { Send, Paperclip, X, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDraft } from "@/hooks/useDraft";
import FileOverlay from "@/components/FileOverlay";

type ChatInputProps = {
  onSend: (message: string, files?: File[]) => void;
  isLoading: boolean;
};

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg", "image/png", "image/gif", "image/bmp", "image/tiff", "image/heic",
];

const ALLOWED_EXT = /\.(jpe?g|png|gif|bmp|tiff?|heic|pdf)$/i;

const ChatInput = ({ onSend, isLoading }: ChatInputProps) => {
  const { text, setText, files, addFiles, removeFile, clearDraft } = useDraft();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewFile, setPreviewFile] = useState<{ src: string; name: string; type: string } | null>(null);

  // Restore textarea height when component remounts with existing text
  useEffect(() => {
    if (textareaRef.current && text) {
      const el = textareaRef.current;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  }, []);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;
    onSend(trimmed, files.length > 0 ? files : undefined);
    clearDraft();
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
    setText(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

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
        className="relative bg-card border border-border rounded-xl shadow-sm px-4 py-3"
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
          title="Datei hochladen (PDF, JPEG, PNG, GIF, BMP, TIFF, HEIC)"
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
          value={text}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          placeholder="Beschreiben Sie die erbrachten Leistungen oder stellen Sie eine Frage zur GOÄ…"
          rows={1}
          className={cn(
            "flex-1 resize-none bg-transparent px-2 py-2 text-sm",
            "text-muted-foreground placeholder:text-muted-foreground focus:outline-none",
            "min-h-[44px] max-h-[200px]"
          )}
        />

        <Button
          onClick={handleSubmit}
          disabled={isLoading || (!text.trim() && files.length === 0)}
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
