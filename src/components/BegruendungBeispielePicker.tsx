import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type BegruendungBeispielePickerProps = {
  beispiele: string[];
  /** Persistierter Entwurf (überschreibt initiale Auswahl) */
  persistedText?: string | null;
  /** Kurze Beschriftungen für die Varianten (optional) */
  labels?: string[];
  surface?: "warnung" | "neutral";
  className?: string;
  onTextChange: (text: string) => void;
  /** Drei neue Vorschläge (Rotation / neues Triplett); optional. */
  onRegenerate?: () => void | Promise<void>;
  /** KI-Neuformulierung läuft — Button deaktivieren. */
  regenerateLoading?: boolean;
  readOnly?: boolean;
};

const DEFAULT_LABELS = ["Variante 1", "Variante 2", "Variante 3"];

/** Wählbare, vollständig ausformulierte Begründungstexte mit Bearbeitung — genau drei Vorschläge, eine Pflichtauswahl. */
export function BegruendungBeispielePicker({
  beispiele,
  persistedText,
  labels,
  surface = "neutral",
  className,
  onTextChange,
  onRegenerate,
  regenerateLoading = false,
  readOnly = false,
}: BegruendungBeispielePickerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const list = useMemo(() => beispiele.filter((s) => s.trim().length > 0).slice(0, 3), [beispiele]);

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const p = persistedText?.trim();
    if (!p) {
      setSelectedIdx(null);
      setDraft("");
      return;
    }
    const i = list.indexOf(p);
    setSelectedIdx(i >= 0 ? i : -1);
    setDraft(p);
  }, [persistedText, list]);

  const lab = labels ?? DEFAULT_LABELS;

  const applyVariant = useCallback(
    (idx: number) => {
      const t = list[idx];
      if (!t) return;
      setSelectedIdx(idx);
      setDraft(t);
      onTextChange(t);
    },
    [list, onTextChange],
  );

  const handleDraft = useCallback(
    (next: string) => {
      setDraft(next);
      setSelectedIdx(-1);
      onTextChange(next);
    },
    [onTextChange],
  );

  const resetToSelected = useCallback(() => {
    if (selectedIdx === null || selectedIdx < 0) return;
    const t = list[selectedIdx];
    if (t) handleDraft(t);
  }, [list, selectedIdx, handleDraft]);

  if (list.length === 0) return null;

  const chipClass =
    surface === "warnung"
      ? "border-amber-500/35 bg-amber-500/[0.06] data-[active=true]:bg-amber-500/15"
      : "border-border bg-muted/30 data-[active=true]:bg-muted";

  const hasChoice = selectedIdx !== null && selectedIdx >= 0;
  const placeholder =
    "Bitte eine der drei Varianten wählen — der Text erscheint hier und kann angepasst werden.";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap gap-1.5">
        {list.map((_, idx) => (
          <button
            key={idx}
            type="button"
            data-active={hasChoice && idx === selectedIdx}
            className={cn(
              "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
              chipClass,
              hasChoice && idx === selectedIdx ? "ring-2 ring-primary/50 bg-primary/10" : "opacity-90",
            )}
            disabled={readOnly}
            onClick={() => (readOnly ? undefined : applyVariant(idx))}
          >
            {lab[idx] ?? `Variante ${idx + 1}`}
          </button>
        ))}
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Text für die Akte (anpassbar)</Label>
        <Textarea
          ref={textareaRef}
          value={draft}
          placeholder={placeholder}
          readOnly={readOnly}
          onChange={(e) => (readOnly ? undefined : handleDraft(e.target.value))}
          rows={6}
          className="text-xs leading-snug min-h-[120px] font-sans"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-[11px] gap-1"
          disabled={readOnly || !hasChoice}
          onClick={resetToSelected}
        >
          <RotateCcw className="w-3 h-3" />
          Zurücksetzen
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[11px] gap-1"
          disabled={readOnly}
          onClick={() => {
            textareaRef.current?.focus();
            textareaRef.current?.select();
          }}
        >
          Bearbeiten
        </Button>
        {onRegenerate ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[11px] gap-1"
            disabled={readOnly || regenerateLoading}
            onClick={() => void onRegenerate()}
          >
            {regenerateLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            Neu generieren
          </Button>
        ) : null}
      </div>
    </div>
  );
}
