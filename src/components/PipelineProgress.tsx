interface PipelineProgressProps {
  step: number;
  totalSteps: number;
  label: string;
}

const STEP_ICONS = ["📄", "🧠", "🔍", "🗂️", "⚖️", "✍️"];

const PipelineProgress = ({ step, totalSteps, label }: PipelineProgressProps) => {
  const progress = Math.round((step / totalSteps) * 100);

  return (
    <div className="flex gap-3 animate-fade-in">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center">
        <div className="w-4 h-4 rounded-full bg-accent-foreground/80" />
      </div>
      <div className="chat-bubble-assistant rounded-2xl rounded-bl-md px-5 py-4 min-w-[320px]">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="text-lg">{STEP_ICONS[step - 1] || "⏳"}</span>
          <span className="text-sm font-medium text-foreground">{label}</span>
        </div>
        <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-xs text-muted-foreground">
            Schritt {step} von {totalSteps}
          </span>
          <span className="text-xs text-muted-foreground">{progress}%</span>
        </div>
      </div>
    </div>
  );
};

export default PipelineProgress;
