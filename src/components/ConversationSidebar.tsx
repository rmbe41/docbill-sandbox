import { useState } from "react";
import { History, Plus, Settings, PanelLeftClose, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import DocBillLogo from "@/assets/DocBill-Logo.svg";

const ICON_CLASS = "w-4 h-4 text-muted-foreground/60";

type Props = {
  onNew: () => void;
  onHistory: () => void;
  onSettings: () => void;
  open: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
};

const ConversationSidebar = ({
  onNew,
  onHistory,
  onSettings,
  open,
  onClose,
  collapsed: controlledCollapsed,
  onCollapsedChange,
}: Props) => {
  const [internalCollapsed, setInternalCollapsed] = useState(true);
  const collapsed = controlledCollapsed ?? internalCollapsed;

  const setCollapsed = (v: boolean) => {
    setInternalCollapsed(v);
    onCollapsedChange?.(v);
  };

  const handleNew = () => {
    onNew();
    onClose();
  };

  const handleHistory = () => {
    onHistory();
    onClose();
  };

  const handleSettings = () => {
    onSettings();
    onClose();
  };

  return (
    <>
      {/* Backdrop on mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden transition-opacity duration-200 ease-in-out"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          "fixed top-2 left-0 bottom-2 z-[100] flex flex-col shrink-0 overflow-hidden",
          "bg-muted/50 dark:bg-muted/20 border border-border/50",
          "rounded-r-xl shadow-lg",
          (open ? "translate-x-0" : "-translate-x-full") + " md:translate-x-0",
          "transition-[width,transform] duration-200 ease-in-out",
          collapsed ? "w-12" : "w-40"
        )}
      >
        {/* Logo (top) - Vertical alignment with header profile (h-14 = 56px) */}
        <div className="flex items-center shrink-0 h-14 gap-0 px-0 pr-2 min-w-0">
          <div className="w-12 min-w-[3rem] flex justify-center items-center shrink-0">
            <img src={DocBillLogo} alt="DocBill" className="w-[22px] h-[22px]" />
          </div>
          {!collapsed && (
            <span className="text-base font-semibold text-foreground truncate min-w-0 -ml-1">DocBill</span>
          )}
        </div>

        {/* Menu items - Icons always in fixed 56px column, no shift */}
        <div className="flex-1 flex flex-col items-stretch justify-end gap-0.5 pb-8 pt-2">
          <Button
            variant="ghost"
            className="h-8 w-full flex items-center justify-start group hover:bg-transparent hover:text-foreground px-0"
            onClick={handleNew}
            title="Neuer Chat"
          >
            <div className="w-12 min-w-[3rem] flex justify-center shrink-0">
              <Plus className={cn(ICON_CLASS, "group-hover:text-primary transition-colors")} />
            </div>
            {!collapsed && <span className="truncate text-left flex-1 pr-2 -ml-4 text-sm text-muted-foreground/60 group-hover:text-primary transition-colors">Neuer Chat</span>}
          </Button>
          <Button
            variant="ghost"
            className="h-8 w-full flex items-center justify-start group hover:bg-transparent hover:text-foreground px-0"
            onClick={handleHistory}
            title="Verlauf"
          >
            <div className="w-12 min-w-[3rem] flex justify-center shrink-0">
              <History className={cn(ICON_CLASS, "group-hover:text-primary transition-colors")} />
            </div>
            {!collapsed && <span className="truncate text-left flex-1 pr-2 -ml-4 text-sm text-muted-foreground/60 group-hover:text-primary transition-colors">Verlauf</span>}
          </Button>
          <Button
            variant="ghost"
            className="h-8 w-full flex items-center justify-start group hover:bg-transparent hover:text-foreground px-0"
            onClick={handleSettings}
            title="Einstellungen"
          >
            <div className="w-12 min-w-[3rem] flex justify-center shrink-0">
              <Settings className={cn(ICON_CLASS, "group-hover:text-primary transition-colors")} />
            </div>
            {!collapsed && <span className="truncate text-left flex-1 pr-2 -ml-4 text-sm text-muted-foreground/60 group-hover:text-primary transition-colors">Einstellungen</span>}
          </Button>

          {/* Expand/Collapse button - same position in both states */}
          <Button
            variant="ghost"
            className="h-8 w-full flex items-center justify-start group hover:bg-transparent hover:text-foreground px-0 mt-1"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Sidebar ausklappen" : "Sidebar einklappen"}
          >
            <div className="w-12 min-w-[3rem] flex justify-center shrink-0">
              {collapsed ? (
                <PanelLeft className={cn(ICON_CLASS, "group-hover:text-primary transition-colors")} />
              ) : (
                <PanelLeftClose className={cn(ICON_CLASS, "group-hover:text-primary transition-colors")} />
              )}
            </div>
            {!collapsed && <span className="truncate text-left flex-1 pr-2 -ml-4 text-sm text-muted-foreground/60 group-hover:text-primary transition-colors">Einklappen</span>}
          </Button>
        </div>
      </aside>
    </>
  );
};

export default ConversationSidebar;
