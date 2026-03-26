import { cn } from "@/lib/utils";

export type SummaryCardVariant = "neutral" | "warning" | "error" | "accent";

type SummaryCardProps = {
  label: string;
  value: number | string;
  detail?: string;
  variant: SummaryCardVariant;
};

const bgClasses: Record<SummaryCardVariant, string> = {
  neutral: "bg-muted/50 dark:bg-muted/30",
  warning: "bg-amber-50 dark:bg-amber-950/30",
  error: "bg-red-50 dark:bg-red-950/30",
  accent: "bg-emerald-50 dark:bg-emerald-950/30",
};

const valueClasses: Record<SummaryCardVariant, string> = {
  neutral: "text-foreground",
  warning: "text-amber-700 dark:text-amber-400",
  error: "text-red-700 dark:text-red-400",
  accent: "text-emerald-700 dark:text-emerald-400",
};

export function SummaryCard({ label, value, detail, variant }: SummaryCardProps) {
  return (
    <div className={cn("rounded-lg p-2.5", bgClasses[variant])}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </p>
      <p className={cn("text-lg font-bold", valueClasses[variant])}>{value}</p>
      {detail && (
        <p className="text-[10px] text-muted-foreground line-clamp-2">{detail}</p>
      )}
    </div>
  );
}
