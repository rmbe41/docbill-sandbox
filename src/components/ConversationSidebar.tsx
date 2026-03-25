import { useState, useRef, type MouseEvent } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import DocBillLogo from "@/assets/DocBill-Logo.svg";
import UserProfileMenu from "@/components/UserProfileMenu";

/** Eine Fläche, keine Zonen-Hover / keine Trennlinien */
const ASIDE_SURFACE = "bg-muted/50 dark:bg-muted/20";

/**
 * Button (ui/button) erzwingt [&_svg]:size-4 — ohne ! bleibt das Zahnrad klein.
 * !size-6 = 24px. ghost hover wird mit hover:!text-foreground überschrieben.
 */
const SETTINGS_ICON_CLASS =
  "shrink-0 !size-5 text-muted-foreground/60 transition-colors group-hover:!text-foreground";

/** Feste Icon-Spalte: gleiche horizontale Position ein- / ausgeklappt */
const ICON_SLOT_HEADER = "w-[3.6rem] min-w-[3.6rem] shrink-0 h-14 flex items-center justify-center";
const ICON_SLOT_ROW = "w-[3.6rem] min-w-[3.6rem] shrink-0 h-11 flex items-center justify-center";

function labelRail(collapsed: boolean) {
  return cn(
    "min-w-0 overflow-hidden transition-[max-width,opacity] duration-200 ease-in-out",
    collapsed ? "max-w-0 opacity-0" : "max-w-[min(8.75rem,100%)] opacity-100 flex-1",
  );
}

type Props = {
  onSettings: () => void;
  onProfile: () => void;
  open: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
};

const ConversationSidebar = ({
  onSettings,
  onProfile,
  open,
  onClose,
  collapsed: controlledCollapsed,
  onCollapsedChange,
}: Props) => {
  const [internalCollapsed, setInternalCollapsed] = useState(true);
  const collapsed = controlledCollapsed ?? internalCollapsed;
  /** Nach Radix-Dropdown: pointerup kann auf dem Aside landen und sonst Ein-/Ausklappen triggern */
  const suppressAsideToggleUntilRef = useRef(0);

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
    if (Date.now() < suppressAsideToggleUntilRef.current) return;
    setCollapsed(!collapsed);
  };

  const handleAfterUserMenuNavigate = () => {
    suppressAsideToggleUntilRef.current = Date.now() + 450;
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
        aria-expanded={!collapsed}
        title={collapsed ? "Sidebar ausklappen" : "Sidebar einklappen"}
        onClick={handleAsideClick}
        className={cn(
          "fixed top-0 left-0 z-[100] flex h-dvh max-h-dvh flex-col shrink-0 cursor-pointer shadow-none",
          ASIDE_SURFACE,
          "overflow-hidden",
          (open ? "translate-x-0" : "-translate-x-full") + " md:translate-x-0",
          "transition-[width,transform] duration-200 ease-in-out",
          collapsed ? "w-[3.6rem]" : "w-48",
        )}
      >
        <div className="flex h-14 w-full shrink-0 items-center">
          <div className={ICON_SLOT_HEADER}>
            <img src={DocBillLogo} alt="DocBill" className="w-[26px] h-[26px] block shrink-0" />
          </div>
          <div className={labelRail(collapsed)}>
            <span className="block truncate pr-2 text-base font-semibold text-foreground">DocBill</span>
          </div>
        </div>

        <div className="flex-1 min-h-0" />

        <div className="flex flex-col items-stretch gap-0.5 pb-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            data-sidebar-interactive
            className="min-h-11 h-11 w-full flex items-center justify-start group shadow-none hover:!bg-transparent hover:!text-foreground px-0 cursor-pointer pointer-events-auto rounded-none"
            onClick={handleSettings}
            title="Einstellungen"
          >
            <div className={ICON_SLOT_ROW}>
              <Settings className={SETTINGS_ICON_CLASS} />
            </div>
            <div className={cn(labelRail(collapsed), "min-h-11 flex items-center min-w-0")}>
              <span className="block truncate text-left pr-2 text-sm text-muted-foreground/60 transition-colors group-hover:!text-foreground">
                Einstellungen
              </span>
            </div>
          </Button>

          <div className="pt-1 pb-0.5 pointer-events-auto px-0">
            <UserProfileMenu
              collapsed={collapsed}
              onAfterNavigate={handleAfterUserMenuNavigate}
              onOpenProfile={onProfile}
            />
          </div>
        </div>
      </aside>
    </>
  );
};

export default ConversationSidebar;
