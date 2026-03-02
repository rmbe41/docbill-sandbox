import { Eye, Settings, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

const AppHeader = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  return (
    <header className="flex items-center gap-3 px-5 py-3 border-b bg-card">
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary">
        <Eye className="w-5 h-5 text-primary-foreground" />
      </div>
      <div className="flex-1">
        <h1 className="text-base font-semibold text-foreground leading-tight">
          GOÄ-DocBilling
        </h1>
        <p className="text-xs text-muted-foreground">
          Abrechnungsassistent für Augenheilkunde
        </p>
      </div>
      {user && (
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground hidden sm:block mr-2 truncate max-w-[150px]">
            {user.email}
          </span>
          <Button variant="ghost" size="icon" onClick={() => navigate("/settings")} title="Einstellungen">
            <Settings className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={signOut} title="Abmelden">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      )}
    </header>
  );
};

export default AppHeader;
