import { LogOut } from "lucide-react";
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

function labelRail(collapsed: boolean) {
  return cn(
    "min-w-0 overflow-hidden transition-[max-width,opacity] duration-200 ease-in-out",
    collapsed ? "max-w-0 opacity-0" : "max-w-[7rem] opacity-100 flex-1",
  );
}

type Props = {
  collapsed: boolean;
  /** z. B. linke Sidebar schließen nach Klick */
  onAfterNavigate?: () => void;
};

const UserProfileMenu = ({ collapsed, onAfterNavigate }: Props) => {
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
          type="button"
          variant="ghost"
          data-sidebar-interactive
          className="h-8 w-full flex items-center justify-start rounded-md shrink-0 pointer-events-auto hover:bg-muted/50 text-muted-foreground hover:text-foreground px-0 min-w-0 cursor-pointer"
          title="Profil"
        >
          <div className="w-12 min-w-[3rem] shrink-0 flex justify-center items-center">
            <Avatar className="h-[22px] w-[22px] shrink-0">
              <AvatarImage src={avatarUrl} alt={user.email ?? ""} />
              <AvatarFallback className="text-[9px] leading-none bg-muted">{getInitials(user.email)}</AvatarFallback>
            </Avatar>
          </div>
          <div className={labelRail(collapsed)}>
            <span className="block truncate text-left pr-2 text-[11px] leading-tight text-muted-foreground/85">
              {user.email}
            </span>
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" sideOffset={8} align="start" className="w-56 z-[100]">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium truncate">{user.email}</p>
            <p className="text-xs text-muted-foreground">Kontostatus: Aktiv</p>
          </div>
        </DropdownMenuLabel>
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
