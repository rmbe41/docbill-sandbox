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
