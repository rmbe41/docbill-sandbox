---
name: post-build-deploy-functions
description: Runs npm run supabase:deploy after build iterations when Edge Function code was modified. Deploys goae-chat and other changed functions. Use when code changes to supabase/functions/ are complete.
alwaysApply: true
---

# Post-Build Deploy Functions

## Nach Build-Iteration

Wenn Code-Änderungen an Supabase Edge Functions abgeschlossen sind:

1. **Deploy direkt ausführen** – nicht nur manuelle Schritte listen
2. **Immer** den npm-Script verwenden: `npm run supabase:deploy`
3. Nie `supabase functions deploy` direkt – das Projekt nutzt npx über den Script

## Abdeckung

- Primär: `goae-chat` (Haupt-Function im Projekt)
- Bei Änderungen an anderen Functions unter `supabase/functions/`: diese ebenfalls deployen
