import { LogOut, User } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Muss mit ConversationSidebar ICON_SLOT_ROW übereinstimmen (kein Springen) */
const ICON_SLOT_ROW = "w-[3.6rem] min-w-[3.6rem] shrink-0 h-10 flex items-center justify-center";

function labelRail(collapsed: boolean) {
  return cn(
    "min-w-0 overflow-hidden transition-[max-width,opacity] duration-200 ease-in-out",
    collapsed ? "max-w-0 opacity-0" : "max-w-[min(8.75rem,100%)] opacity-100 flex-1",
  );
}

function displayNameFromUser(user: User): string | null {
  const m = user.user_metadata ?? {};
  const n =
    (m.full_name as string | undefined)?.trim() ||
    (m.display_name as string | undefined)?.trim() ||
    (m.name as string | undefined)?.trim();
  return n || null;
}

function getInitials(user: User): string {
  const name = displayNameFromUser(user);
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  const email = user.email;
  if (!email) return "?";
  const part = email.split("@")[0];
  if (part.length >= 2) return part.slice(0, 2).toUpperCase();
  return part.slice(0, 1).toUpperCase();
}

type Props = {
  collapsed: boolean;
  /** z. B. linke Sidebar schließen nach Klick */
  onAfterNavigate?: () => void;
  /** Profil-Bereich in der Mitte (wie Einstellungen) */
  onOpenProfile: () => void;
};

const UserProfileMenu = ({ collapsed, onAfterNavigate, onOpenProfile }: Props) => {
  const { user, signOut } = useAuth();
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;

  if (!user) return null;

  const wrap = (fn: () => void) => () => {
    fn();
    onAfterNavigate?.();
  };

  const profileName = displayNameFromUser(user);
  const railLabel = profileName ?? user.email ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-sidebar-interactive
          className="min-h-10 h-10 w-full flex items-center justify-start group shadow-none hover:bg-transparent hover:text-foreground px-0 min-w-0 cursor-pointer pointer-events-auto rounded-none"
          title="Profil"
        >
          <div className={ICON_SLOT_ROW}>
            <Avatar className="h-[26px] w-[26px] shrink-0">
              <AvatarImage src={avatarUrl} alt="" />
              <AvatarFallback className="text-[10px] leading-none bg-muted">{getInitials(user)}</AvatarFallback>
            </Avatar>
          </div>
          <div className={cn(labelRail(collapsed), "min-h-10 flex items-center min-w-0")}>
            <span
              className={cn(
                "block w-full text-left pr-2 text-sm text-muted-foreground/60 group-hover:text-accent-subtle-foreground transition-colors",
                profileName ? "break-words whitespace-normal leading-snug line-clamp-2" : "truncate",
              )}
            >
              {railLabel}
            </span>
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        sideOffset={8}
        align="start"
        className="w-56 z-[100]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-1">
            {profileName ? <p className="text-sm font-medium break-words">{profileName}</p> : null}
            <p className={cn("text-sm font-medium", profileName ? "text-muted-foreground" : "", "truncate")}>
              {user.email}
            </p>
            <p className="text-xs text-muted-foreground">Kontostatus: Aktiv</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={wrap(() => onOpenProfile())}>
          <User className="w-4 h-4 mr-2" />
          Profil & Konto
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={wrap(() => void signOut())} className="text-destructive">
          <LogOut className="w-4 h-4 mr-2" />
          Abmelden
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserProfileMenu;
