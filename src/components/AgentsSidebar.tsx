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
        "fixed top-4 right-0 bottom-4 w-64",
        "bg-muted/50 dark:bg-muted/20 border border-border/50 border-r-0",
        "rounded-l-xl shadow-lg overflow-hidden",
        className,
      )}
    >
      <div className="px-2 py-1.5 border-b border-border/30 shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "group w-full h-8 gap-1.5 justify-center rounded-md border border-border/25 bg-transparent font-normal text-xs text-muted-foreground shadow-none",
            "hover:bg-muted/60 hover:text-foreground hover:border-border/45",
          )}
          onClick={onNew}
          title="Neuer Chat"
        >
          <Plus className="h-3.5 w-3.5 opacity-60 group-hover:opacity-100" />
          Neuer Chat
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-2 py-3 pb-16">
          <HistoryPanel {...panelProps} layout="sidebar" />
        </div>
      </ScrollArea>
    </aside>
  );
};

export default AgentsSidebar;
