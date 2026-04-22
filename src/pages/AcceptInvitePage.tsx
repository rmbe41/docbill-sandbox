import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

type RpcResult = {
  ok?: boolean;
  error?: string;
  message?: string;
};

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [line, setLine] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [working, setWorking] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setWorking(false);
      setLine("Bitte anmelden und den Link danach erneut öffnen.");
      setIsError(false);
      return;
    }
    if (!token) {
      setWorking(false);
      setLine("Ungültiger Link.");
      setIsError(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("accept_organisation_invite", { p_token: token });
      if (cancelled) return;
      setWorking(false);
      if (error) {
        setIsError(true);
        setLine(error.message);
        return;
      }
      const r = data as RpcResult;
      if (r?.ok) {
        setIsError(false);
        setLine(
          r.message === "already_in_org" ? "Sie sind bereits in dieser Organisation." : "Einladung angenommen.",
        );
        return;
      }
      setIsError(true);
      if (r?.error === "email_mismatch") {
        setLine("Die E-Mail Ihres Accounts stimmt nicht mit der Einladung überein.");
        return;
      }
      if (r?.error === "org_has_data" && typeof r.message === "string") {
        setLine(r.message);
        return;
      }
      setLine("Einladung ungültig oder abgelaufen.");
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, token]);

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-6 bg-background">
      {working ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          Einladung wird verarbeitet…
        </div>
      ) : (
        <p
          className={`text-sm text-center max-w-md ${
            isError ? "text-destructive" : "text-foreground"
          }`}
        >
          {line}
        </p>
      )}
      <Button type="button" className="mt-6" variant="outline" onClick={() => navigate("/")}>
        Zur Startseite
      </Button>
    </div>
  );
}
