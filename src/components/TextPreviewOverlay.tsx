import { useEffect, useCallback } from "react";
import { X } from "lucide-react";

interface TextPreviewOverlayProps {
  filename: string;
  content: string;
  onClose: () => void;
}

export default function TextPreviewOverlay({ filename, content, onClose }: TextPreviewOverlayProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="relative z-[1] flex flex-col w-full max-w-3xl max-h-[85vh] rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="font-medium text-foreground truncate">{filename}</span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Schließen (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <pre className="flex-1 overflow-auto p-4 text-sm text-foreground whitespace-pre-wrap font-sans">
          {content || "(Kein Inhalt)"}
        </pre>
      </div>
    </div>
  );
}
