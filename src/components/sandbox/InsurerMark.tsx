import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { getInsurerBranding } from "@/lib/sandbox/insurerBranding";

export function InsurerMark({
  name,
  size = "sm",
  className,
}: {
  name: string | undefined | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const { logoUrls, mark } = useMemo(() => getInsurerBranding(name), [name]);
  const [urlIndex, setUrlIndex] = useState(0);
  const px = size === "md" ? 22 : 16;

  useEffect(() => {
    setUrlIndex(0);
  }, [name]);

  const logoUrl = logoUrls[urlIndex];
  const exhausted = logoUrls.length === 0 || urlIndex >= logoUrls.length;

  if (exhausted) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center shrink-0 rounded-md border border-border/70 bg-muted/60 text-[9px] font-semibold text-muted-foreground tabular-nums",
          size === "md" ? "h-[22px] min-w-[22px] px-0.5" : "h-4 min-w-[16px] px-0.5",
          className,
        )}
        title={name ?? ""}
        aria-hidden={!name}
      >
        {mark.slice(0, 2)}
      </span>
    );
  }

  return (
    <img
      src={logoUrl}
      width={px}
      height={px}
      alt=""
      className={cn("shrink-0 rounded-md object-contain bg-background ring-1 ring-border/40", className)}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setUrlIndex((i) => i + 1)}
    />
  );
}

export function InsurerLabelRow({
  name,
  className,
  textClassName,
}: {
  name: string;
  className?: string;
  textClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 min-w-0", className)}>
      <InsurerMark name={name} />
      <span className={cn("min-w-0 truncate", textClassName)} title={name}>
        {name}
      </span>
    </span>
  );
}
