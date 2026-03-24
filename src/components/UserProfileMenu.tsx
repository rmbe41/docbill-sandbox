import { LogOut, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
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

function getInitials(email: string | undefined): string {
  if (!email) return "?";
  const part = email.split("@")[0];
  if (part.length >= 2) return part.slice(0, 2).toUpperCase();
  return part.slice(0, 1).toUpperCase();
}

type Props = {
  collapsed: boolean;
  /** DocBill inline settings (Index) — zusätzlich zu /settings */
  onInlineSettings?: () => void;
  /** z. B. linke Sidebar schließen nach Klick */
  onAfterNavigate?: () => void;
};

const UserProfileMenu = ({ collapsed, onInlineSettings, onAfterNavigate }: Props) => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;

  if (!user) return null;

  const wrap = (fn: () => void) => () => {
    fn();
    onAfterNavigate?.();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "rounded-lg shrink-0 pointer-events-auto hover:bg-muted/60",
            collapsed ? "h-10 w-10 p-0 mx-auto" : "h-10 w-full justify-start px-2 gap-2",
          )}
          title="Profil"
        >
          <Avatar className={cn("shrink-0", collapsed ? "h-8 w-8" : "h-8 w-8")}>
            <AvatarImage src={avatarUrl} alt={user.email ?? ""} />
            <AvatarFallback className="text-xs bg-muted">{getInitials(user.email)}</AvatarFallback>
          </Avatar>
          {!collapsed && (
            <span className="truncate text-left text-sm text-muted-foreground/90 min-w-0 flex-1">
              {user.email}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={collapsed ? "start" : "start"}
        side="top"
        sideOffset={8}
        className="w-56 z-[100]"
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium truncate">{user.email}</p>
            <p className="text-xs text-muted-foreground">Kontostatus: Aktiv</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={wrap(() => (onInlineSettings ? onInlineSettings() : navigate("/settings")))}
        >
          <Settings className="w-4 h-4 mr-2" />
          Einstellungen
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
