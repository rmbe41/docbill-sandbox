import { useState } from "react";
import { Settings, PanelLeftClose, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import DocBillLogo from "@/assets/DocBill-Logo.svg";
import UserProfileMenu from "@/components/UserProfileMenu";

const ICON_CLASS = "w-4 h-4 text-muted-foreground/60";

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
        className={cn(
          "fixed top-4 left-0 bottom-4 z-[100] flex flex-col shrink-0",
          "bg-muted/50 dark:bg-muted/20 border border-border/50",
          "rounded-r-xl shadow-lg",
          (open ? "translate-x-0" : "-translate-x-full") + " md:translate-x-0",
          "transition-[width,transform] duration-200 ease-in-out",
          collapsed ? "w-12" : "w-40",
        )}
      >
        <Button
          variant="ghost"
          className={cn(
            "h-12 w-full flex items-center shrink-0 rounded-none hover:bg-transparent hover:opacity-80 cursor-pointer",
            collapsed ? "justify-center px-0" : "justify-start px-0 pr-2 min-w-0 gap-0",
          )}
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Sidebar ausklappen" : "Sidebar einklappen"}
        >
          <div className="w-12 min-w-[3rem] flex justify-center items-center shrink-0">
            <img src={DocBillLogo} alt="DocBill" className="w-[22px] h-[22px] block" />
          </div>
          {!collapsed && (
            <span className="text-base font-semibold text-foreground truncate min-w-0 -ml-1">DocBill</span>
          )}
        </Button>

        <div className="flex-1 min-h-0" />

        <div className="flex flex-col items-stretch gap-0.5 pb-2 pt-1 border-t border-border/30">
          <Button
            variant="ghost"
            className="h-8 w-full flex items-center justify-start group hover:bg-transparent hover:text-foreground px-0"
            onClick={handleSettings}
            title="Einstellungen"
          >
            <div className="w-12 min-w-[3rem] flex justify-center shrink-0">
              <Settings className={cn(ICON_CLASS, "group-hover:text-accent-subtle-foreground transition-colors")} />
            </div>
            {!collapsed && (
              <span className="truncate text-left flex-1 pr-2 -ml-4 text-sm text-muted-foreground/60 group-hover:text-accent-subtle-foreground transition-colors">
                Einstellungen
              </span>
            )}
          </Button>

          <Button
            variant="ghost"
            className="h-8 w-full flex items-center justify-start group hover:bg-transparent hover:text-foreground px-0"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Sidebar ausklappen" : "Sidebar einklappen"}
          >
            <div className="w-12 min-w-[3rem] flex justify-center shrink-0">
              {collapsed ? (
                <PanelLeft className={cn(ICON_CLASS, "group-hover:text-accent-subtle-foreground transition-colors")} />
              ) : (
                <PanelLeftClose
                  className={cn(ICON_CLASS, "group-hover:text-accent-subtle-foreground transition-colors")}
                />
              )}
            </div>
            {!collapsed && (
              <span className="truncate text-left flex-1 pr-2 -ml-4 text-sm text-muted-foreground/60 group-hover:text-accent-subtle-foreground transition-colors">
                Einklappen
              </span>
            )}
          </Button>

          <div className={cn("pt-2 px-1", collapsed && "flex justify-center px-0")}>
            <UserProfileMenu collapsed={collapsed} onInlineSettings={handleSettings} onAfterNavigate={onClose} />
          </div>
        </div>
      </aside>
    </>
  );
};

export default ConversationSidebar;
