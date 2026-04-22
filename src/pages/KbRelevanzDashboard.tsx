import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type ReviewRow = {
  id: string;
  titel: string | null;
  quelle: string | null;
  aktion: string;
  created_at: string;
  decision: string | null;
};

export default function KbRelevanzDashboard() {
  const navigate = useNavigate();
  const { user, loading: authLoading, isAdmin } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("kb_beschluesse_review")
      .select("id, titel, quelle, aktion, created_at, decision")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error(error);
      setRows([]);
    } else {
      setRows((data ?? []) as ReviewRow[]);
    }
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    if (authLoading) return;
    void refresh();
  }, [authLoading, refresh]);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    if (!user) return;
    const { error } = await supabase
      .from("kb_beschluesse_review")
      .update({
        decision,
        decided_at: new Date().toISOString(),
        decided_by: user.id,
      })
      .eq("id", id);
    if (error) {
      toast({ title: "Speichern fehlgeschlagen", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: decision === "approved" ? "Freigegeben" : "Verworfen" });
    void refresh();
  };

  if (authLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-dvh p-6">
        <Button variant="ghost" size="sm" className="gap-1 mb-4" onClick={() => navigate("/")}>
          <ArrowLeft className="w-4 h-4" />
          Zurück
        </Button>
        <p className="text-sm text-muted-foreground">Diese Seite ist nur für Produkt-Admins sichtbar.</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh p-4 md:p-8 max-w-4xl mx-auto">
      <Button variant="ghost" size="sm" className="gap-1 mb-6" onClick={() => navigate("/")}>
        <ArrowLeft className="w-4 h-4" />
        Zurück
      </Button>
      <h1 className="text-lg font-semibold mb-1">Beschluss-Relevanz (manuelle Prüfung)</h1>
      <p className="text-xs text-muted-foreground mb-6">
        Spec 7.3: Einträge aus der Pipeline. Freigabe oder Verwerfen (Embedding/Import anbinden im nächsten Schritt).
      </p>
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine offenen Einträge.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="border border-border rounded-lg p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-medium">{r.titel ?? "(ohne Titel)"}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.quelle ?? "—"} · {new Date(r.created_at).toLocaleString("de-DE")} · {r.aktion}
                    {r.decision ? ` · ${r.decision}` : ""}
                  </p>
                </div>
                {r.decision == null ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void decide(r.id, "approved")}
                    >
                      Freigeben
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void decide(r.id, "rejected")}
                    >
                      Verwerfen
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
