import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import HistoryPanel, { type HistoryPanelProps } from "@/components/HistoryPanel";

type Props = Omit<HistoryPanelProps, "layout"> & {
  onNew: () => void;
  className?: string;
};

const AgentsSidebar = ({ onNew, className, ...panelProps }: Props) => {
  return (
    <aside
      className={cn(
        "hidden md:flex flex-col shrink-0 z-[100]",
        "fixed top-4 right-0 bottom-0 w-72",
        "bg-muted/50 dark:bg-muted/20 border border-border/50 border-r-0 border-b-0",
        "rounded-tl-xl shadow-lg overflow-hidden",
        className,
      )}
    >
      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div className="min-w-0 px-2 py-3 pb-4">
          <HistoryPanel {...panelProps} layout="sidebar" />
        </div>
      </ScrollArea>
      <div className="shrink-0 px-2 pt-2">
        <Button
          type="button"
          variant="outline"
          className={cn(
            "group h-auto min-h-[68px] w-full justify-center gap-2.5 rounded-xl border-border bg-card px-3 py-3 text-sm font-medium text-foreground shadow-none",
            "hover:bg-muted/80 hover:text-foreground",
            "[&_svg]:size-5 [&_svg]:opacity-90 [&_svg]:group-hover:opacity-100",
          )}
          onClick={onNew}
          title="Neuer Chat"
        >
          <Plus className="shrink-0" />
          Neuer Chat
        </Button>
        <div className="mt-1.5 min-h-7" aria-hidden />
        <div className="pb-10" />
      </div>
    </aside>
  );
};

export default AgentsSidebar;
