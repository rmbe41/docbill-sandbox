import React, { useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";

const PARTICLE_COLORS = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-amber-400",
  "bg-violet-500",
  "bg-rose-400",
  "bg-primary",
] as const;

const CELEBRATION_MS = 1950;

type FeedbackThanksBurstProps = {
  show: boolean;
  onComplete?: () => void;
  className?: string;
};

/** Kurzer Confetti-Burst und Danke-Text, verschwindet per CSS-Animation. */
export function FeedbackThanksBurst({ show, onComplete, className }: FeedbackThanksBurstProps) {
  const seeds = useMemo(() => {
    const n = 14;
    return Array.from({ length: n }, (_, i) => {
      const angle = (i / n) * Math.PI * 2 + (Math.sin(i * 12.9898) * 0.35 + 0.2);
      const dist = 26 + (i % 4) * 8 + Math.sin(i * 3.7) * 6;
      const x = Math.round(Math.cos(angle) * dist * 10) / 10;
      const y = Math.round((-Math.sin(angle) * dist - 14) * 10) / 10;
      const rot = Math.round(((i * 47) % 360) - 180);
      const delayMs = Math.round(i * 25 + (i % 3) * 8);
      const h = 3 + (i % 3);
      const w = i % 2 === 0 ? 4 : 3;
      return { x, y, rot, delayMs, h, w, color: PARTICLE_COLORS[i % PARTICLE_COLORS.length] };
    });
  }, []);

  useEffect(() => {
    if (!show) return;
    const id = window.setTimeout(() => onComplete?.(), CELEBRATION_MS);
    return () => window.clearTimeout(id);
  }, [show, onComplete]);

  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 flex flex-col items-center",
        "animate-feedback-thanks",
        className,
      )}
    >
      <div className="relative h-14 w-36">
        {seeds.map((p, i) => (
          <span
            key={i}
            className={cn(
              "absolute left-1/2 bottom-0 origin-center rounded-[1px] opacity-95 shadow-sm animate-confetti-burst",
              p.color,
            )}
            style={
              {
                width: p.w,
                height: p.h,
                animationDelay: `${p.delayMs}ms`,
                "--burst-x": `${p.x}px`,
                "--burst-y": `${p.y}px`,
                "--burst-r": `${p.rot}deg`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <p className="mt-0.5 whitespace-nowrap text-center text-xs font-semibold text-emerald-700 dark:text-emerald-400">
        Danke für Ihr Feedback
      </p>
    </div>
  );
}
