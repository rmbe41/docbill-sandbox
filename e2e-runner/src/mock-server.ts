/**
 * Lokaler Mock für E2E ohne deployte Supabase-Instanz (CI / lokal).
 * Implementiert die gleichen Pfade wie die Blackbox-Erwartungen.
 */
import http from "node:http";

export function createMockServer(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && (path === "/functions/v1/health" || path === "/api/health")) {
      const body = JSON.stringify({
        status: "healthy",
        components: {
          database: "ok",
          vector_db: "ok",
          llm_api: "ok",
          goae_json: { status: "ok", version: "2026-Q2" },
          ebm_json: { status: "ok", version: "2026-Q2" },
        },
        timestamp: new Date().toISOString(),
        response_time_ms: 1,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }

    if (req.method === "POST" && path === "/functions/v1/delete-account") {
      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Authorization required" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    /** Blackbox smoke: Modus C liefert mindestens ein docbill_analyse-SSE-Event (Spec 02 / Cycle-02 E2E). */
    if (req.method === "POST" && path === "/functions/v1/goae-chat") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf8");
          const j = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
          if (j.steigerung_begruendung_regenerate) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                begruendung:
                  "Mock-Steigerungsbegründung: erhöhter Zeitaufwand bei der genannten Leistung, mehrfache Abstimmung und dokumentierter Mehraufwand im konkreten Behandlungsfall.",
              }),
            );
            return;
          }
        } catch {
          /* SSE-Fallback */
        }
        const kategorien = Array.from({ length: 8 }, (_, i) => ({
          kategorie: i + 1,
          titel: `Kategorie ${i + 1}`,
          status: "ok" as const,
          items: [] as unknown[],
        }));
        const parsingData = {
          positionen_count: 5,
          ziffern: ["1240", "1256", "5855", "6", "75"],
        };
        const data = {
          version: 1 as const,
          mode: "C" as const,
          regelwerk: "GOAE" as const,
          kategorien,
          dualOptions: [] as unknown[],
          einwilligungsHinweise: [] as unknown[],
          disclaimer:
            "DocBill ist eine KI und kann Fehler machen. Eine Kontrolle der Ergebnisse ist erforderlich.",
        };
        const line0 = `data: ${JSON.stringify({ type: "docbill_parsing", data: parsingData })}\n\n`;
        const line1 = `data: ${JSON.stringify({ type: "docbill_analyse", data })}\n\n`;
        res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
        res.end(line0 + line1);
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });
}
