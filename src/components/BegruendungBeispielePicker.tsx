import { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
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
};

const DEFAULT_LABELS = [
  "Variante 1",
  "Variante 2",
  "Variante 3",
  "Variante 4",
  "Variante 5",
  "Variante 6",
];

/** Wählbare, vollständig ausformulierte Begründungstexte mit Bearbeitung. */
export function BegruendungBeispielePicker({
  beispiele,
  persistedText,
  labels,
  surface = "neutral",
  className,
  onTextChange,
}: BegruendungBeispielePickerProps) {
  const list = beispiele.filter((s) => s.trim().length > 0);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [draft, setDraft] = useState(() => persistedText?.trim() || list[0] || "");

  useEffect(() => {
    const p = persistedText?.trim();
    if (!p) return;
    setDraft(p);
    const i = list.indexOf(p);
    if (i >= 0) setSelectedIdx(i);
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
      onTextChange(next);
    },
    [onTextChange],
  );

  const resetToSelected = useCallback(() => {
    const t = list[selectedIdx];
    if (t) handleDraft(t);
  }, [list, selectedIdx, handleDraft]);

  if (list.length === 0) return null;

  const chipClass =
    surface === "warnung"
      ? "border-amber-500/35 bg-amber-500/[0.06] data-[active=true]:bg-amber-500/15"
      : "border-border bg-muted/30 data-[active=true]:bg-muted";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap gap-1.5">
        {list.map((_, idx) => (
          <button
            key={idx}
            type="button"
            data-active={idx === selectedIdx}
            className={cn(
              "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
              chipClass,
              idx === selectedIdx ? "ring-1 ring-primary/40" : "",
            )}
            onClick={() => applyVariant(idx)}
          >
            {lab[idx] ?? `Variante ${idx + 1}`}
          </button>
        ))}
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Text für die Akte (anpassbar)</Label>
        <Textarea
          value={draft}
          onChange={(e) => handleDraft(e.target.value)}
          rows={6}
          className="text-xs leading-snug min-h-[120px] font-sans"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={resetToSelected}>
          <RotateCcw className="w-3 h-3" />
          Zurücksetzen
        </Button>
      </div>
    </div>
  );
}
