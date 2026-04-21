# DocBill – Cycle-Pläne

## §2.1 Prinzipien (aus `specs/01_DEV_LIFECYCLE.md`)

1. Jedes Inkrement ist lauffähig und testbar; kein reines Setup ohne Nutzen für Endnutzer oder Betrieb.
2. Abhängigkeiten: Auth & Datenmodell vor Features; einfache Modi vor komplexen; Einzelverarbeitung vor Batch.
3. Frühes Feedback: z. B. Fragestellung vor Rechnungsprüfung und Batch.
4. Pro Cycle: E2E-Blackbox (§2.2) und Code-Review-Agent (§2.4) bestanden, bevor der nächste Cycle startet.
5. Maximale Cycle-Dauer: drei Wochen; bei größerem Scope aufteilen.

## Beispiel-Reihenfolge (nicht bindend)

Foundation → Modus C → Modus A → Modus B → Batch/PAD → Wissens-Management → Feedback/Analytics → Compliance/Launch.

## Pläne

| Datei                            | Inhalt                                                        |
| -------------------------------- | ------------------------------------------------------------- |
| `01_DEV_LIFECYCLE_CursorPLAN.md` | Cycle 01: E2E, Health, CI, Review-Agent, Monitoring-Grundlage |

## PostHog: Event `health_check`

- Wird von der Edge Function **`health`** bei jedem erfolgreichen Lauf gesendet (Ingest: `https://eu.i.posthog.com/i/v0/e/` bzw. optional `POSTHOG_INGEST_URL` / `POSTHOG_HOST`).
- **In PostHog:** *Activity* / *Live events* oder *Data management* → nach Event-Name **`health_check`** filtern; Properties u. a. `overall`, `response_time_ms`, `source: supabase_edge_health`.
- Supabase Secrets: `POSTHOG_API_KEY` (Project API Key `phc_…`).

## Alerting (PostHog → Slack) — Checkliste

Konfiguration in PostHog/Slack nach Spec §2.3:

| Bedingung                             | Aktion                        |
| ------------------------------------- | ----------------------------- |
| Health-Check 3× fehlgeschlagen        | Slack Critical                |
| API P95-Latenz > 120 s über 5 Minuten | Slack Warning                 |
| Error-Rate > 5 % über 10 Minuten      | Slack Critical                |
| LLM-API nicht erreichbar              | Slack + Fallback-Modus klären |
