---
name: auto-push-localhost
description: Executes Supabase deploy commands (db push, functions deploy) directly instead of listing manual steps. Preserves localhost URLs and configuration unchanged. Use when creating migrations, Edge Functions, or deploying Supabase changes.
alwaysApply: true
---

# Auto-Push und Localhost

## Änderungen selbst ausführen

- Führe Befehle wie `supabase db push`, `npm run supabase:deploy` selbst aus, statt "Nächste Schritte" zu listen
- Gib keine manuellen Anweisungen wie "Migration im SQL Editor ausführen" oder "Edge Function deployen"
- Wenn du Migrations oder Edge Functions erstellst/änderst: führe die zugehörigen Deploy-Befehle direkt aus (Edge Functions: `npm run supabase:deploy`)
- Sage Bescheid, wenn alles geklappt hat – mit konkretem Ergebnis und wo deployed wurde

## Localhost beibehalten

- Ändere keine localhost-URLs oder -Konfiguration
- API-Endpoints, Supabase-URLs und ähnliche Werte für lokale Entwicklung bleiben unverändert
