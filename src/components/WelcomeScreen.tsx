import { FileText, HelpCircle, ClipboardCheck } from "lucide-react";
import DocBillLogo from "@/assets/DocBill-Logo.svg";

const suggestions = [
  {
    icon: ClipboardCheck,
    label: "Leistungen abrechnen",
    text: "Ich habe eine Funduskopie in Mydriasis gemacht und den Augeninnendruck gemessen. Was kann ich abrechnen?",
  },
  {
    icon: FileText,
    label: "Rechnung prüfen",
    text: "Bitte prüfe meine Rechnung auf Optimierungspotenziale und fehlende Leistungen.",
  },
  {
    icon: HelpCircle,
    label: "GOÄ-Frage stellen",
    text: "Wie oft darf ich die GOÄ 401 im Quartal ansetzen?",
  },
];

type WelcomeScreenProps = {
  onSuggestionClick: (text: string) => void;
};

const WelcomeScreen = ({ onSuggestionClick }: WelcomeScreenProps) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 pt-20 pb-12 animate-fade-in">
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl overflow-hidden mb-6">
        <img src={DocBillLogo} alt="DocBill Logo" className="w-16 h-16" />
      </div>

      <h2 className="text-xl font-semibold text-foreground mb-2">
        Willkommen bei DocBill
      </h2>
      <p className="text-sm text-muted-foreground text-center max-w-md mb-8">
        Ihr KI-Assistent für die ophthalmologische GOÄ-Abrechnung. 
        Beschreiben Sie Ihre erbrachten Leistungen, laden Sie eine Rechnung hoch 
        oder stellen Sie eine Frage.
      </p>

      <div className="grid gap-3 w-full max-w-md">
        {suggestions.map((s) => (
          <button
            key={s.label}
            onClick={() => onSuggestionClick(s.text)}
            className="flex items-center gap-3 text-left px-4 py-3 rounded-xl border bg-card hover:bg-muted/60 transition-colors group"
          >
            <s.icon className="w-5 h-5 text-accent flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground group-hover:text-accent-subtle-foreground transition-colors">
                {s.label}
              </p>
              <p className="text-xs text-muted-foreground line-clamp-1">
                {s.text}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default WelcomeScreen;
