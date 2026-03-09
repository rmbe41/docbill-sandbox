# DocBill – Edge Function deployen

Führe diese Befehle **nacheinander** im Terminal aus:

## 1. Bei Supabase einloggen

```bash
cd /Users/robinbetz/docbill
npx supabase login
```

Es öffnet sich ein Browser – dort mit deinem Supabase-Account anmelden.

## 2. Projekt verknüpfen

```bash
npx supabase link --project-ref qxaijnupaxxxsqaivbtj
```

Falls nach einem Datenbank-Passwort gefragt wird: Das hast du beim Erstellen des Supabase-Projekts gesetzt.

## 3. Edge Function deployen

```bash
npx supabase functions deploy goae-chat
```

## 4. Prüfen

Im Supabase Dashboard unter **Edge Functions** sollte `goae-chat` erscheinen.

## 5. App starten

```bash
npm run dev
```

Dann Chat testen – die AI-Anfragen laufen über die deployte Function.
