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
      <div className="p-2 border-b border-border/40 shrink-0">
        <Button
          type="button"
          variant="default"
          size="sm"
          className="w-full gap-2 justify-center rounded-lg"
          onClick={onNew}
          title="Neuer Chat"
        >
          <Plus className="w-4 h-4" />
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
