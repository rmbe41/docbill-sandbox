import { cn } from "@/lib/utils";
import { DOCBILL_KI_DISCLAIMER } from "@/lib/rechnung/docbillDisclaimer";

/** Spec 00 / 07 §11: einheitlicher Hinweis; im Chat zentral in `ChatBubble` am Turn-Ende, sonst u. a. Rechnung/Batch. */
export function DocbillKiDisclaimerFooter({ className }: { className?: string }) {
  return (
    <p
      className={cn("text-[11px] text-muted-foreground border-t border-border/50 pt-2 mt-3", className)}
      role="note"
    >
      {DOCBILL_KI_DISCLAIMER}
    </p>
  );
}
