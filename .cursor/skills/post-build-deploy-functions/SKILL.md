---
name: post-build-deploy-functions
description: Runs supabase functions deploy after build iterations when Edge Function code was modified. Deploys goae-chat and other changed functions. Use when code changes to supabase/functions/ are complete.
alwaysApply: true
---

# Post-Build Deploy Functions

## Nach Build-Iteration

Wenn Code-Änderungen an Supabase Edge Functions abgeschlossen sind:

1. **Deploy direkt ausführen** – nicht nur manuelle Schritte listen
2. Befehl ausführen: `supabase functions deploy goae-chat`
3. Bei weiteren geänderten Functions: jeweils `supabase functions deploy <name>` ausführen

## Wenn Supabase CLI nicht verfügbar

Falls `supabase` nicht im PATH ist oder der Befehl fehlschlägt:

- Kurz melden: "Supabase CLI lokal nicht verfügbar"
- Klare manuelle Anweisung geben: `supabase functions deploy goae-chat` (und ggf. weitere Functions)
- Nicht ausführlich erklären – nur den Befehl nennen

## Abdeckung

- Primär: `goae-chat` (Haupt-Function im Projekt)
- Bei Änderungen an anderen Functions unter `supabase/functions/`: diese ebenfalls deployen
