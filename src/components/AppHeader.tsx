import { Settings, LogOut, History } from "lucide-react";
import DocBillLogo from "@/assets/DocBill-Logo.svg";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

type Props = {
  onToggleHistory?: () => void;
};

const AppHeader = ({ onToggleHistory }: Props) => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  return (
    <header className="flex items-center gap-3 px-5 py-3 border-b bg-card">
      {user && onToggleHistory && (
        <Button variant="ghost" size="icon" onClick={onToggleHistory} title="Verlauf">
          <History className="w-4 h-4" />
        </Button>
      )}
      <div className="flex items-center justify-center w-9 h-9 rounded-lg overflow-hidden">
        <img src={DocBillLogo} alt="DocBill Logo" className="w-9 h-9" />
      </div>
      <div className="flex-1">
        <h1 className="text-base font-semibold text-foreground leading-tight">
          DocBill
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
