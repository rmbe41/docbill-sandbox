# DocBill – KI-Abrechnungsassistent für Augenheilkunde

AI-gestützter GOÄ-Abrechnungsassistent für Augenärzte.

## Features

- GOÄ-konforme Rechnungsprüfung und -optimierung
- Rechnungserstellung aus erbrachten Leistungen
- Fragen zur GOÄ beantworten
- PDF- und Bild-Upload (OCR-Analyse)
- Verlauf / Gesprächshistorie
- LLM-Auswahl, Dark Mode, UI-Skalierung
- Admin-System mit globalen Regeln und Kontext-Upload

## Tech Stack

- **Frontend**: React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Supabase (Auth, Database, Edge Functions)
- **AI**: OpenRouter API (Gemini, GPT-5, etc.)

## Setup

1. **Neues Supabase-Projekt anlegen** – siehe [SUPABASE_SETUP.md](SUPABASE_SETUP.md)
2. `.env` aus `.env.example` erstellen und mit deinen Supabase-Werten füllen
3. App starten:

```bash
npm install
npm run dev
```

Environment variables (`.env`):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_SUPABASE_PROJECT_ID=...
```

Supabase Edge Function secrets (im Dashboard setzen):

```
OPENROUTER_API_KEY=...
```

## Dokumentation

- [docs/README.md](docs/README.md) – Inhaltsverzeichnis der technischen Doku
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – Architektur und Umgebungen
- [docs/PIPELINE.md](docs/PIPELINE.md) – Pipelines und Intent-Routing
- [docs/API-goae-chat.md](docs/API-goae-chat.md) – API/SSE-Vertrag `goae-chat`
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) – Datenmodell
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) – Fehlerbehebung
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) – Mitwirkung
- [docs/SECURITY.md](docs/SECURITY.md) – Sicherheit und Datenschutz (Überblick)

Setup und Deploy: [SUPABASE_SETUP.md](SUPABASE_SETUP.md), [DEPLOY_ANLEITUNG.md](DEPLOY_ANLEITUNG.md).
