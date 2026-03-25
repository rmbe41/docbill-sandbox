# DocBill – Fehlerbehebung und Betrieb

## Logs (Supabase)

1. Supabase Dashboard → **Edge Functions** → **`goae-chat`** → **Logs**.
2. Filtern nach Exceptions, OpenRouter-Antworten oder Konsolenausgaben.

### Deploy-Stand prüfen

Bei jedem Request schreibt die Function einen Prüfstring ins Log:

`DOCBILL_INSTRUMENTATION_84BF6E goae-chat request`

Wenn dieser String **fehlt**, läuft vermutlich noch eine **alte** Deploy-Version. Neu deployen: [DEPLOY_ANLEITUNG.md](../DEPLOY_ANLEITUNG.md).

## Häufige Ursachen

| Problem | Was prüfen |
|---------|------------|
| „OPENROUTER_API_KEY …“ / 503 | Supabase **Secrets**: `OPENROUTER_API_KEY` gesetzt und nicht leer; nach Änderung Function neu deployen falls nötig. |
| 401 / Gateway-Hinweis auf ungültigen Key | Schlüssel in OpenRouter erneuern, Secret im Dashboard aktualisieren. |
| 429 Rate Limit | OpenRouter/Modell-Limits; später erneut versuchen oder anderes Modell. |
| 402 Credits | OpenRouter-Guthaben aufladen. |
| Stream bricht ab / Timeout | Lange Parser-LLM-Läufe: die Pipeline sendet **SSE keepalive** (`: keepalive`); Proxies müssen Streaming nicht puffern. Client: AbortSignal nur bei echtem Abbruch. |
| Leere oder hängende Antwort (Simple Engine) | Simple-Pipeline liefert kein `pipeline_result` — nur Text; bei Parserfehler in Logs nachsehen. |
| `FREE_MODELS_EXHAUSTED` (Free-Modell) | Gratis-Kontingent erschöpft; kostenpflichtiges Modell wählen oder warten. |

HTTP-/Gateway-Mappings: [`handleApiError`](../supabase/functions/goae-chat/index.ts). Stream-Fehler-Events: [API-goae-chat.md](./API-goae-chat.md).

## Frontend

- Chat-URL und Proxy: [ARCHITECTURE.md](./ARCHITECTURE.md).
- Wenn strukturierte Karten fehlen: prüfen, ob die **Standard-** und nicht die **Simple-** Engine aktiv ist und ob der Workflow **Rechnungsprüfung** (nicht reiner Chat) ist.

## Datenbank

- Nach Schemafehlern: Migrationen in [`supabase/migrations/`](../supabase/migrations/) mit lokalem/remote Stand abgleichen.
- Siehe auch [SUPABASE_SETUP.md](../SUPABASE_SETUP.md) für frische Projekte.
