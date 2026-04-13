import { cn } from "@/lib/utils";

export type BulkReviewCase = {
  id: string;
  title: string;
  count: number;
  /** Optional: Anzahl Zeilen mit Warnung/Fehler in diesem Block */
  issueCount?: number;
};

type BulkReviewQueueProps = {
  cases: BulkReviewCase[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
};

/**
 * Warteschlange für Massen-Review (mehrere Quellen / PAD-Segmente).
 * Ein Klick filtert die Detailtabelle im Eltern-Component auf `selectedId`.
 */
export function BulkReviewQueue({ cases, selectedId, onSelect, className }: BulkReviewQueueProps) {
  if (cases.length <= 1) return null;
  return (
    <div className={cn("rounded-lg border border-border/70 bg-muted/15 px-3 py-2", className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Offene Fälle ({cases.length})
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
            selectedId == null
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border bg-card hover:bg-muted/50",
          )}
        >
          Alle anzeigen
        </button>
        {cases.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors max-w-[220px] truncate",
              selectedId === c.id
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-card hover:bg-muted/50",
            )}
            title={c.title}
          >
            {c.title}
            <span className="text-muted-foreground font-normal"> · {c.count}</span>
            {c.issueCount != null && c.issueCount > 0 ? (
              <span className="text-amber-700 dark:text-amber-300 font-normal"> · {c.issueCount} offen</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
