import { useState, type MouseEvent } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import DocBillLogo from "@/assets/DocBill-Logo.svg";
import UserProfileMenu from "@/components/UserProfileMenu";

const ICON_CLASS = "w-4 h-4 text-muted-foreground/60";

function labelRail(collapsed: boolean) {
  return cn(
    "min-w-0 overflow-hidden transition-[max-width,opacity] duration-200 ease-in-out",
    collapsed ? "max-w-0 opacity-0" : "max-w-[7rem] opacity-100 flex-1",
  );
}

type Props = {
  onSettings: () => void;
  open: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
};

const ConversationSidebar = ({
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

  const handleSettings = () => {
    onSettings();
    onClose();
  };

  const handleAsideClick = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("[data-sidebar-interactive]")) return;
    setCollapsed(!collapsed);
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden transition-opacity duration-200 ease-in-out"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        aria-expanded={!collapsed}
        title={collapsed ? "Sidebar ausklappen" : "Sidebar einklappen"}
        onClick={handleAsideClick}
        className={cn(
          "fixed top-4 left-0 bottom-4 z-[100] flex flex-col shrink-0 cursor-pointer",
          "bg-muted/50 dark:bg-muted/20 border border-border/50",
          "rounded-r-xl shadow-lg",
          (open ? "translate-x-0" : "-translate-x-full") + " md:translate-x-0",
          "transition-[width,transform] duration-200 ease-in-out",
          collapsed ? "w-12" : "w-40",
        )}
      >
        <div className="h-12 w-full flex items-center shrink-0 rounded-none">
          <div className="w-12 min-w-[3rem] shrink-0 flex justify-center items-center">
            <img src={DocBillLogo} alt="DocBill" className="w-[22px] h-[22px] block" />
          </div>
          <div className={labelRail(collapsed)}>
            <span className="block truncate pr-2 text-base font-semibold text-foreground">DocBill</span>
          </div>
        </div>

        <div className="flex-1 min-h-0" />

        <div className="flex flex-col items-stretch gap-0.5 pb-2 pt-1 border-t border-border/30">
          <Button
            type="button"
            variant="ghost"
            data-sidebar-interactive
            className="h-8 w-full flex items-center justify-start group hover:bg-transparent hover:text-foreground px-0 cursor-pointer pointer-events-auto"
            onClick={handleSettings}
            title="Einstellungen"
          >
            <div className="w-12 min-w-[3rem] flex justify-center shrink-0">
              <Settings className={cn(ICON_CLASS, "group-hover:text-accent-subtle-foreground transition-colors")} />
            </div>
            <div className={labelRail(collapsed)}>
              <span className="block truncate text-left pr-2 text-sm text-muted-foreground/60 group-hover:text-accent-subtle-foreground transition-colors">
                Einstellungen
              </span>
            </div>
          </Button>

          <div className="pt-1 px-0.5 pb-0.5 pointer-events-auto">
            <UserProfileMenu collapsed={collapsed} onAfterNavigate={onClose} />
          </div>
        </div>
      </aside>
    </>
  );
};

export default ConversationSidebar;
