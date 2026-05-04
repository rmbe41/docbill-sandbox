import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useSandbox } from "@/lib/sandbox/sandboxStore";

/** Ladephase (~1,5 s) vor Review; legt ggf. Rechnung mit Status „proposed“ an. */
export default function SandboxAnalysePage() {
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();
  const { createInvoiceForDocumentation } = useSandbox();
  const createRef = useRef(createInvoiceForDocumentation);
  createRef.current = createInvoiceForDocumentation;

  useEffect(() => {
    if (!docId) {
      navigate("/dokumentationen", { replace: true });
      return;
    }
    const t = window.setTimeout(() => {
      const inv = createRef.current(docId);
      if (inv) navigate(`/review/${inv.id}`, { replace: true });
      else navigate("/dokumentationen", { replace: true });
    }, 1500);

    return () => window.clearTimeout(t);
  }, [docId, navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center px-4">
      <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden />
      <div>
        <p className="text-sm font-medium">Dokumentation wird ausgewertet…</p>
        <p className="text-xs text-muted-foreground mt-2 max-w-sm">Bitte kurz warten — der Abrechnungsvorschlag wird vorbereitet.</p>
      </div>
    </div>
  );
}
