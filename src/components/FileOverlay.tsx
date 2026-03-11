import { useEffect, useCallback, useState } from "react";
import { X, ZoomIn, ZoomOut, RotateCw, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileOverlayProps {
  src?: string;
  name: string;
  type: string;
  onClose: () => void;
}

export default function FileOverlay({ src, name, type, onClose }: FileOverlayProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  const isImage = type.startsWith("image/") || /\.(jpe?g|png|gif|bmp|tiff?|heic)$/i.test(name);
  const isPdf = type === "application/pdf" || name.toLowerCase().endsWith(".pdf");

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setScale((s) => Math.min(s + 0.25, 5));
      if (e.key === "-") setScale((s) => Math.max(s - 0.25, 0.25));
      if (e.key === "r") setRotation((r) => (r + 90) % 360);
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

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      return Math.max(0.25, Math.min(s + delta, 5));
    });
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop – Klick schließt Overlay */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Toolbar */}
      <div
        className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-black/60 backdrop-blur-md rounded-full px-3 py-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-white/80 text-sm font-medium px-2 truncate max-w-[200px]">
          {name}
        </span>
        <div className="w-px h-5 bg-white/20 mx-1" />
        {isImage && (
          <>
            <ToolbarButton
              icon={ZoomOut}
              onClick={() => setScale((s) => Math.max(s - 0.25, 0.25))}
              title="Verkleinern (−)"
            />
            <span className="text-white/60 text-xs font-mono w-12 text-center">
              {Math.round(scale * 100)}%
            </span>
            <ToolbarButton
              icon={ZoomIn}
              onClick={() => setScale((s) => Math.min(s + 0.25, 5))}
              title="Vergrößern (+)"
            />
            <ToolbarButton
              icon={RotateCw}
              onClick={() => setRotation((r) => (r + 90) % 360)}
              title="Drehen (R)"
            />
            <div className="w-px h-5 bg-white/20 mx-1" />
          </>
        )}
        <ToolbarButton icon={X} onClick={onClose} title="Schließen (Esc)" />
      </div>

      {/* Content – Klick auf leeren Bereich (außer Bild/PDF) schließt via Backdrop */}
      <div className="relative z-[1] flex items-center justify-center w-full h-full p-12 pointer-events-none">
        {isImage && src && (
          <img
            src={src}
            alt={name}
            className="max-w-full max-h-full object-contain select-none transition-transform duration-200 pointer-events-auto"
            style={{
              transform: `scale(${scale}) rotate(${rotation}deg)`,
            }}
            onWheel={handleWheel}
            onClick={onClose}
            draggable={false}
          />
        )}

        {isPdf && src && (
          <iframe
            src={src}
            title={name}
            className="w-full max-w-4xl h-[85vh] rounded-lg border border-white/10 bg-white pointer-events-auto"
          />
        )}

        {!isImage && !isPdf && (
          <div className="flex flex-col items-center gap-4 text-white/80 pointer-events-auto">
            <FileText className="w-16 h-16" />
            <p className="text-lg font-medium">{name}</p>
            <p className="text-sm text-white/50">Vorschau nicht verfügbar</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  onClick,
  title,
}: {
  icon: typeof X;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
