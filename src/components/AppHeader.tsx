import { LogOut, Menu, Settings, ArrowLeft, PanelRight, User } from "lucide-react";
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

type ViewType = "chat" | "settings" | "profile";

type Props = {
  onToggleSidebar?: () => void;
  /** Mobile: Chats & Aufgaben (rechte Sidebar als Sheet) */
  onOpenAgentsSheet?: () => void;
  viewType?: ViewType;
  onBack?: () => void;
  /** Mobile: Profil im Hauptbereich wie Einstellungen in der App */
  onOpenProfile?: () => void;
};

function getInitials(email: string | undefined): string {
  if (!email) return "?";
  const part = email.split("@")[0];
  if (part.length >= 2) return part.slice(0, 2).toUpperCase();
  return part.slice(0, 1).toUpperCase();
}

const AppHeader = ({ onToggleSidebar, onOpenAgentsSheet, viewType = "chat", onBack, onOpenProfile }: Props) => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;

  const showBack = viewType !== "chat" && onBack;

  return (
    <header className="flex items-center justify-between gap-3 px-4 md:px-5 py-3 h-14 shrink-0 bg-transparent border-none pointer-events-none">
      <div className="flex items-center gap-1 min-w-0">
        {showBack ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              title="Zurück"
              className="shrink-0 pointer-events-auto"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            {viewType === "settings" && (
              <h1 className="text-base font-semibold text-foreground truncate">Einstellungen</h1>
            )}
            {viewType === "profile" && (
              <h1 className="text-base font-semibold text-foreground truncate">Profil & Konto</h1>
            )}
          </>
        ) : (
          <>
            {user && onToggleSidebar ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleSidebar}
                title="Menü"
                className="md:hidden shrink-0 pointer-events-auto"
              >
                <Menu className="w-4 h-4" />
              </Button>
            ) : null}
            {user && viewType === "chat" && onOpenAgentsSheet ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={onOpenAgentsSheet}
                title="Chats und Aufgaben"
                className="md:hidden shrink-0 pointer-events-auto"
              >
                <PanelRight className="w-4 h-4" />
              </Button>
            ) : null}
          </>
        )}
      </div>
      <div className="flex-1 min-w-0" />
      {user && (
        <div className="md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full shrink-0 pointer-events-auto">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={avatarUrl} alt={user.email ?? ""} />
                  <AvatarFallback className="text-xs bg-muted">
                    {getInitials(user.email)}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-56 z-[100]">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium truncate">{user.email}</p>
                  <p className="text-xs text-muted-foreground">Kontostatus: Aktiv</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  onOpenProfile?.();
                }}
              >
                <User className="w-4 h-4 mr-2" />
                Profil & Konto
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/settings")}>
                <Settings className="w-4 h-4 mr-2" />
                Einstellungen
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void signOut()} className="text-destructive">
                <LogOut className="w-4 h-4 mr-2" />
                Abmelden
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </header>
  );
};

export default AppHeader;
