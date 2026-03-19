import { useEffect, useState } from "react";
import DocBillLogo from "@/assets/DocBill-Logo.svg";

interface PipelineProgressProps {
  step: number;
  totalSteps: number;
  label: string;
  startTime?: number;
}

const STEP_ICONS = ["📄", "🧠", "🔍", "🗂️", "⚖️", "✍️"];

/** Dauer der Sub-Progress-Animation pro Schritt (ms) */
const SUB_PROGRESS_DURATION = 2500;
/** Anteil des Schritts, der während des Wartens gefüllt wird (0–1) */
const SUB_PROGRESS_FILL = 0.92;

const PipelineProgress = ({ step, totalSteps, label, startTime }: PipelineProgressProps) => {
  const baseProgress = ((step - 1) / totalSteps) * 100;
  const stepSize = 100 / totalSteps;
  const [subProgress, setSubProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (startTime == null) return;
    const tick = () => setElapsed((Date.now() - startTime) / 1000);
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [startTime]);

  useEffect(() => {
    setSubProgress(0);
    let startTime: number;
    let cancelled = false;
    const animate = (now: number) => {
      if (cancelled) return;
      if (startTime === undefined) startTime = now;
      const elapsed = now - startTime;
      const t = Math.min(elapsed / SUB_PROGRESS_DURATION, 1);
      const easeOut = 1 - (1 - t) ** 3;
      setSubProgress(stepSize * SUB_PROGRESS_FILL * easeOut);
      if (t < 1) requestAnimationFrame(animate);
    };
    const id = requestAnimationFrame(animate);
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [step, totalSteps, stepSize]);

  const progress = Math.min(100, baseProgress + subProgress);

  return (
    <div className="flex gap-3 animate-fade-in">
      <div className="flex-shrink-0 w-8 h-8 rounded-full overflow-hidden mt-1">
        <img
          src={DocBillLogo}
          alt="DocBill"
          className="w-8 h-8 animate-logo-working"
        />
      </div>
      <div className="flex flex-col gap-1 min-w-0 max-w-[95%] sm:max-w-[90%]">
        <div className="chat-bubble-assistant rounded-2xl rounded-bl-md px-5 py-4 min-w-[320px]">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-lg">{STEP_ICONS[step - 1] || "⏳"}</span>
            <span className="text-sm font-medium text-foreground">{label}</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-[width] duration-200 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-xs text-muted-foreground">
              Schritt {step} von {totalSteps}
            </span>
            <span className="text-xs text-muted-foreground">{Math.round(progress)}%</span>
          </div>
        </div>
        {startTime != null && (
          <div className="flex justify-end w-full">
            <span className="text-[10px] text-muted-foreground">
              {elapsed.toFixed(1).replace(".", ",")} s
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default PipelineProgress;
