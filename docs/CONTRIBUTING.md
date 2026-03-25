# DocBill – Mitwirkung

## Lokale Entwicklung

```bash
npm install
npm run dev
```

Der Vite-Server nutzt Port **8080** (siehe `vite.config.ts`). Supabase-URLs und Keys kommen aus `.env` (Vorlage: `.env.example`).

## Datenbank

- Schemaänderungen als SQL unter [`supabase/migrations/`](../supabase/migrations/).
- Nach Änderungen am Schema die Typen in [`src/integrations/supabase/types.ts`](../src/integrations/supabase/types.ts) anpassen (CLI-`gen types` oder manuell), damit TypeScript und App konsistent bleiben.
- Ersteinrichtung eines Supabase-Projekts: [SUPABASE_SETUP.md](../SUPABASE_SETUP.md).

## Edge Functions

- Implementierung unter [`supabase/functions/goae-chat/`](../supabase/functions/goae-chat/).
- Deploy und Link beschreibt [DEPLOY_ANLEITUNG.md](../DEPLOY_ANLEITUNG.md) (Projekt-Ref dort durch euer Projekt ersetzen).

## Doku

- Technische Übersicht: [docs/README.md](./README.md).
- Bei Pipeline- oder API-Änderungen **API-goae-chat.md** und **PIPELINE.md** mitpflegen.

## Stil

- Änderungen möglichst fokussiert; Namenskonventionen und Struktur des bestehenden Codes beibehalten.
