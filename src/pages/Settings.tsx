import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import SettingsContent from "@/components/SettingsContent";
import { useAuth } from "@/hooks/useAuth";

const Settings = () => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 px-5 py-3 border-b bg-card">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-base font-semibold text-foreground">Einstellungen</h1>
      </header>

      <SettingsContent initialTab={isAdmin ? "global" : undefined} />
    </div>
  );
};

export default Settings;
