# DocBill – Technische Dokumentation

Einstieg für Entwickler:innen. Projekt-Setup und Supabase-Erstkonfiguration weiterhin im Repository-Root verlinkt.

## Im Root

| Datei | Inhalt |
|-------|--------|
| [README.md](../README.md) | Features, Tech-Stack, kurzes Setup, Env-Variablen |
| [SUPABASE_SETUP.md](../SUPABASE_SETUP.md) | Neues Supabase-Projekt, Schema/Seed, OAuth-URLs |
| [DEPLOY_ANLEITUNG.md](../DEPLOY_ANLEITUNG.md) | Edge Function `goae-chat` deployen |

## In `docs/`

| Datei | Inhalt |
|-------|--------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Komponenten, Datenfluss, Engine-Settings, Dev- vs. Prod-URL |
| [PIPELINE.md](./PIPELINE.md) | Intent-Routing, Service-Billing, 6- vs. 2-Schritt-Rechnungspipeline, Chat |
| [API-goae-chat.md](./API-goae-chat.md) | POST-Body, Auth, SSE-`type`-Tabelle, HTTP-Fehler |
| [DATA_MODEL.md](./DATA_MODEL.md) | Tabellen, `structured_content`, Jobs, RLS-Hinweise |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Logs, Instrumentierung, typische Fehler |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Lokales Dev, Migrations, Functions |
| [SECURITY.md](./SECURITY.md) | Datenflüsse, OpenRouter, keine Legal-Beratung |

## Sonstige Skript-Dokus

- [scripts/pdf-ingest/README.md](../scripts/pdf-ingest/README.md) – PDF-Ingest
