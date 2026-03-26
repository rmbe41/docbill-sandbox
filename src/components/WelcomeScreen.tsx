import { FileText, HelpCircle, ClipboardCheck, type LucideIcon } from "lucide-react";
import DocBillLogo from "@/assets/DocBill-Logo.svg";
import type { GuidedWorkflowKind } from "@/lib/guidedWorkflow";

type SuggestionItem = {
  icon: LucideIcon;
  label: string;
  description: string;
  workflow: GuidedWorkflowKind;
  userMessage: string;
};

const suggestions: SuggestionItem[] = [
  {
    icon: ClipboardCheck,
    label: "Leistungen abrechnen",
    description: "Leistungen beschreiben oder Akte hochladen – ich frage nach, was fehlt.",
    workflow: "leistungen_abrechnen",
    userMessage: "Leistungen abrechnen",
  },
  {
    icon: FileText,
    label: "Rechnung prüfen",
    description: "Rechnung und optional Patientenakte hochladen – ich frage zuerst nach den Unterlagen.",
    workflow: "rechnung_pruefen",
    userMessage: "Rechnung prüfen",
  },
  {
    icon: HelpCircle,
    label: "GOÄ-Frage stellen",
    description: "Ich frage, was Sie wissen möchten, und nenne kurz die wichtigsten Möglichkeiten.",
    workflow: "frage_oeffnen",
    userMessage: "Ich möchte eine Frage stellen.",
  },
];

export type WelcomePick = { workflow: GuidedWorkflowKind; text: string };

type WelcomeScreenProps = {
  onPick: (pick: WelcomePick) => void;
};

const WelcomeScreen = ({ onPick }: WelcomeScreenProps) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 pt-20 pb-12">
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl overflow-hidden mb-6">
        <img src={DocBillLogo} alt="DocBill Logo" className="w-16 h-16" />
      </div>

      <h2 className="text-xl font-semibold text-foreground mb-2">
        Willkommen bei DocBill
      </h2>
      <p className="text-sm text-muted-foreground text-center max-w-md mb-8">
        Ihr KI-Assistent für die ophthalmologische GOÄ-Abrechnung. 
        Beschreiben Sie Ihre erbrachten Leistungen, laden Sie eine Rechnung hoch 
        oder stellen Sie eine Frage. Das System erkennt automatisch, was Sie brauchen.
      </p>

      <div className="grid gap-3 w-full max-w-md">
        {suggestions.map((s) => (
          <button
            key={s.label}
            onClick={() =>
              onPick({ workflow: s.workflow, text: s.userMessage })
            }
            className="flex items-center gap-3 text-left px-4 py-3 rounded-xl border bg-card hover:bg-muted/60 transition-colors group"
          >
            <s.icon className="w-5 h-5 text-accent flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground group-hover:text-accent-subtle-foreground transition-colors">
                {s.label}
              </p>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {s.description}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default WelcomeScreen;
