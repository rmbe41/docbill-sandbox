import { useAuth } from "@/hooks/useAuth";
import { useOrganisation } from "@/hooks/useOrganisation";
import { useSearchParams } from "react-router-dom";

/**
 * Spec 02 / 07 — minimales Feedback-Dashboard (Aggregation folgt in späteren Iterationen).
 * Spec 13.2: Zugang Organisations-Admin und -Manager; Produkt-Admin (user_roles) zusätzlich.
 */
const FeedbackDashboard = () => {
  const { user, loading } = useAuth();
  const { loading: orgLoading, canViewFeedbackDashboard } = useOrganisation();
  const [searchParams] = useSearchParams();
  const demo = searchParams.get("demo") === "true";
  const loadingGates = loading || orgLoading;

  if (loadingGates) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Laden…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2 bg-background px-4">
        <p className="text-muted-foreground">Bitte anmelden.</p>
      </div>
    );
  }

  if (!canViewFeedbackDashboard) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2 bg-background px-4">
        <h1 className="text-lg font-medium">Feedback-Dashboard</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Nur für Organisations-Administratoren, Organisations-Manager (Spec 13.2) oder interne
          Produkt-Administratoren. Bei Bedarf Ihre Organisationsrolle prüfen lassen.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="max-w-3xl mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">Feedback-Dashboard</h1>
        <p className="text-muted-foreground">
          Annahme-/Ablehnungsraten und Review-Warteschlange werden aus gespeichertem Feedback aggregiert
          (Storage JSONL + Metadaten). Diese Seite ist der Rahmen für Cycle 02; Detailkarten folgen mit
          Aggregation-API.
        </p>
        {demo && (
          <p className="text-sm border border-dashed rounded-md p-3 bg-muted/40">
            Demo-Modus aktiv (<code>?demo=true</code>) — für PostHog/Feature-Flags im Produktivbetrieb
            koppeln.
          </p>
        )}
        <section className="rounded-lg border p-4 space-y-2">
          <h2 className="font-medium">Vorschlag-Feedback</h2>
          <p className="text-sm text-muted-foreground">
            Payload erweitert um <code>metadata.vorschlag_id</code>, <code>metadata.feedback_kind</code>,{" "}
            <code>metadata.aktion</code> (siehe Edge Function <code>feedback</code>).
          </p>
        </section>
      </div>
    </div>
  );
};

export default FeedbackDashboard;
