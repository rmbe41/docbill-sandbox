import { useEffect, useState } from "react";
import DocBillLogo from "@/assets/DocBill-Logo.svg";

interface AnalysisStopwatchProps {
  startTime: number;
}

const AnalysisStopwatch = ({ startTime }: AnalysisStopwatchProps) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const tick = () => {
      setElapsed((Date.now() - startTime) / 1000);
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [startTime]);

  const formatted = elapsed.toFixed(1).replace(".", ",");

  return (
    <div className="flex gap-3 animate-fade-in">
      <div className="flex-shrink-0 w-8 h-8 rounded-full overflow-hidden mt-1">
        <img src={DocBillLogo} alt="DocBill" className="w-8 h-8" />
      </div>
      <div className="flex flex-col gap-1 min-w-0 max-w-[95%] sm:max-w-[90%]">
        <div className="chat-bubble-assistant rounded-2xl rounded-bl-md px-4 py-3">
          <div className="flex gap-1.5 items-center h-5">
            <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-pulse-dot" style={{ animationDelay: "0ms" }} />
            <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-pulse-dot" style={{ animationDelay: "200ms" }} />
            <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-pulse-dot" style={{ animationDelay: "400ms" }} />
          </div>
        </div>
        <div className="flex justify-end w-full">
          <span className="text-[10px] text-muted-foreground">{formatted} s</span>
        </div>
      </div>
    </div>
  );
};

export default AnalysisStopwatch;
