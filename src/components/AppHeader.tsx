import { Eye } from "lucide-react";

const AppHeader = () => {
  return (
    <header className="flex items-center gap-3 px-5 py-3 border-b bg-card">
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary">
        <Eye className="w-5 h-5 text-primary-foreground" />
      </div>
      <div>
        <h1 className="text-base font-semibold text-foreground leading-tight">
          GOÄ-DocBilling
        </h1>
        <p className="text-xs text-muted-foreground">
          Abrechnungsassistent für Augenheilkunde
        </p>
      </div>
    </header>
  );
};

export default AppHeader;
