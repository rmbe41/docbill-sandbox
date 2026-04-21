import { useEffect, useState } from "react";
import { de } from "@/messages/de";
import { captureHealthPageView, initPostHog } from "@/lib/observability/posthog";

interface HealthPayload {
  status: string;
  components: Record<string, unknown>;
  timestamp: string;
  response_time_ms: number;
}

export default function Status() {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initPostHog();
    captureHealthPageView();
  }, []);

  useEffect(() => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl) {
      setErr("VITE_SUPABASE_URL fehlt");
      setLoading(false);
      return;
    }
    const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/health`;
    fetch(url, {
      headers: anon ? { apikey: anon } : {},
    })
      .then(async (res) => {
        if (!res.ok) {
          setErr(`${res.status} ${res.statusText}`);
          return;
        }
        const j = (await res.json()) as HealthPayload;
        setData(j);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-background p-8 font-sans">
      <h1 className="text-2xl font-semibold text-foreground mb-2">{de.status.title}</h1>
      <p className="text-sm text-muted-foreground mb-6">
        DocBill — öffentliche Systemprüfung (Health-Endpoint). Keine Anmeldung erforderlich.
      </p>
      {loading && <p className="text-muted-foreground">{de.status.loading}</p>}
      {err && (
        <p className="text-destructive">
          {de.status.error} {err}
        </p>
      )}
      {data && (
        <div className="space-y-4">
          <p className="text-foreground">
            {data.status === "healthy" && de.status.healthy}
            {data.status === "degraded" && de.status.degraded}
            {data.status === "unhealthy" && de.status.unhealthy}
          </p>
          <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto border border-border max-w-4xl">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
