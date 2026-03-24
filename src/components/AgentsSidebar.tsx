import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  CHAT_COMPOSER_DOCK_BELOW_CARD,
  CHAT_COMPOSER_DOCK_BOTTOM_PAD,
  CHAT_COMPOSER_DOCK_TOP_PAD,
  CHAT_COMPOSER_OUTER_HEIGHT_CLASS,
} from "@/components/ChatInput";
import HistoryPanel, { type HistoryPanelProps } from "@/components/HistoryPanel";

const ASIDE_SURFACE = "bg-muted/50 dark:bg-muted/20";

type Props = Omit<HistoryPanelProps, "layout"> & {
  onNew: () => void;
  className?: string;
};

const AgentsSidebar = ({ onNew, className, ...panelProps }: Props) => {
  const [sidebarTab, setSidebarTab] = useState<"chats" | "archive">("chats");

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col shrink-0 z-[100]",
        "fixed top-0 right-0 bottom-0 w-72",
        ASIDE_SURFACE,
        "overflow-hidden",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-12 w-full shrink-0 items-center pl-2 pr-3.5 transition-colors",
          ASIDE_SURFACE,
          "hover:bg-muted/40 dark:hover:bg-muted/28",
        )}
      >
        <div className="flex min-w-0 flex-1 gap-1.5">
          <button
            type="button"
            className={cn(
              "flex-1 rounded-lg border py-1.5 text-xs font-medium shadow-none transition-colors",
              sidebarTab === "chats"
                ? "border-border bg-foreground/[0.115] text-foreground dark:border-border dark:bg-muted/88"
                : "border-border/55 text-muted-foreground hover:border-border/80 hover:bg-foreground/[0.065] hover:text-foreground dark:border-border/50 dark:hover:border-border/70 dark:hover:bg-muted/52 dark:hover:text-foreground",
            )}
            onClick={() => setSidebarTab("chats")}
          >
            Chats
          </button>
          <button
            type="button"
            className={cn(
              "flex-1 rounded-lg border py-1.5 text-xs font-medium shadow-none transition-colors",
              sidebarTab === "archive"
                ? "border-border bg-foreground/[0.115] text-foreground dark:border-border dark:bg-muted/88"
                : "border-border/55 text-muted-foreground hover:border-border/80 hover:bg-foreground/[0.065] hover:text-foreground dark:border-border/50 dark:hover:border-border/70 dark:hover:bg-muted/52 dark:hover:text-foreground",
            )}
            onClick={() => setSidebarTab("archive")}
          >
            Archiv
          </button>
        </div>
      </div>
      <ScrollArea className={cn("min-h-0 min-w-0 flex-1", ASIDE_SURFACE)}>
        <div className="min-w-0 pl-2 pr-3.5 py-3 pb-4">
          <HistoryPanel
            {...panelProps}
            layout="sidebar"
            sidebarTab={sidebarTab}
            onSidebarTabChange={setSidebarTab}
            hideCompactTabBar
          />
        </div>
      </ScrollArea>
      <div
        className={cn(
          "shrink-0 pl-2 pr-3.5 transition-colors",
          ASIDE_SURFACE,
          "hover:bg-muted/40 dark:hover:bg-muted/28",
          CHAT_COMPOSER_DOCK_TOP_PAD,
          CHAT_COMPOSER_DOCK_BOTTOM_PAD,
        )}
      >
        <Button
          type="button"
          variant="ghost"
          className={cn(
            "group w-full inline-flex items-center justify-center gap-2.5 rounded-xl px-3 text-sm font-medium text-foreground shadow-none",
            "transition-[background-color,border-color,transform,color] duration-200 ease-out",
            "active:scale-[0.99]",
            CHAT_COMPOSER_OUTER_HEIGHT_CLASS,
            "border border-border/80 bg-foreground/[0.065] dark:border-border/70 dark:bg-muted/52",
            "hover:border-border hover:bg-foreground/[0.115] hover:!text-foreground dark:hover:border-border dark:hover:bg-muted/88",
            "active:border-border active:bg-foreground/[0.115] active:text-foreground dark:active:border-border dark:active:bg-muted/88",
            "[&_svg]:size-5 [&_svg]:opacity-90 [&_svg]:transition-transform [&_svg]:duration-200 [&_svg]:ease-out [&_svg]:group-hover:scale-105 [&_svg]:group-hover:opacity-100",
          )}
          onClick={onNew}
          title="Neuer Chat"
        >
          <Plus className="shrink-0" />
          Neuer Chat
        </Button>
        <div className={CHAT_COMPOSER_DOCK_BELOW_CARD} aria-hidden />
      </div>
    </aside>
  );
};

export default AgentsSidebar;
