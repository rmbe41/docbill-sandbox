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
          vector_db: "unknown",
          llm_api: "ok",
          goae_json: { status: "ok", version: "2026-Q2" },
          ebm_json: { status: "unknown", version: "n/a" },
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

    res.writeHead(404);
    res.end();
  });
}
