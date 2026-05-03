import { cn } from "@/lib/utils";
import type { ConfidenceLevel } from "@/lib/sandbox/types";
import type { InsuranceType } from "@/lib/sandbox/types";

function fallbackPercentForTier(tier: ConfidenceLevel): number {
  if (tier === "high") return 91;
  if (tier === "medium") return 66;
  return 36;
}

export function ConfidenceDot({
  tier,
  percent,
}: {
  tier: ConfidenceLevel;
  /** Optional für ältere persistierte States ohne Feld */
  percent?: number;
}) {
  const cls =
    tier === "high"
      ? "bg-emerald-600 dark:bg-emerald-500 ring-1 ring-background"
      : tier === "medium"
        ? "bg-amber-600 dark:bg-amber-500 ring-1 ring-background"
        : "bg-red-600 dark:bg-red-500 ring-1 ring-background";
  const p = percent ?? fallbackPercentForTier(tier);
  const tierWord = tier === "high" ? "hoch" : tier === "medium" ? "mittel" : "niedrig";
  const title = `Konfidenz ${tierWord} · ${p} %`;
  return (
    <span className="inline-flex items-center gap-1 shrink-0" title={title}>
      <span className={cn("inline-block h-2 w-2 rounded-full", cls)} aria-hidden />
      <span className="text-[10px] tabular-nums text-muted-foreground leading-none">{p} %</span>
    </span>
  );
}

export function PayerChip({ type }: { type: InsuranceType }) {
  const label = type === "GKV" ? "GKV" : type === "PKV" ? "PKV" : "Selbstzahler";
  const cls =
    type === "PKV"
      ? "bg-secondary text-secondary-foreground border border-border/60"
      : "bg-muted text-foreground border border-border/60";
  return <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-md tabular-nums", cls)}>{label}</span>;
}
