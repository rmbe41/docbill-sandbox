# Health-Endpoint (Spec §2.3)

Die Spezifikation nennt `GET /api/health`. Technisch liefert die **Supabase Edge Function** `health` unter:

`{SUPABASE_URL}/functions/v1/health`

## Lokal (Vite)

`vite.config.ts` mappt im Dev-Server `GET /api/health` → dieselbe Antwort (Proxy auf `VITE_SUPABASE_URL` / Fallback-Projekt).

## Produktion

- **Vercel:** `vercel.json` enthält ein Rewrite ` /api/health` → eure `…/functions/v1/health`. `destination` muss auf das richtige Supabase-Projekt zeigen, wenn es vom Default abweicht.
- **Anderes Hosting / CDN:** gleiches Muster: Rewrite oder Worker von `/api/health` zur Function-URL.
- **Monitoring (PostHog Synthetics, etc.):** entweder die **öffentliche Function-URL** oder – nach Deploy – `https://<eure-app>/api/health`, sofern das Rewrite aktiv ist.

## E2E

Fixture `HEALTH_001` prüft `GET …/functions/v1/health` (Blackbox-URL).
