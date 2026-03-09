# DocBill – Supabase Setup (Neues Projekt)

Diese Anleitung beschreibt, wie du ein eigenes Supabase-Projekt erstellst und DocBill damit verbindest.

## Schritt 1: Supabase-Projekt erstellen

1. Gehe zu [supabase.com](https://supabase.com) und melde dich an (oder registriere dich mit Google/E-Mail).
2. Klicke auf **New Project**.
3. Wähle oder erstelle eine **Organization**.
4. Gib einen **Project name** ein (z.B. `docbill`).
5. Setze ein sicheres **Database password** und speichere es.
6. Wähle eine **Region** (z.B. Frankfurt für EU).
7. Klicke auf **Create new project** und warte, bis das Projekt bereit ist.

## Schritt 2: Datenbank-Schema einspielen

1. Im Supabase Dashboard: **SQL Editor** öffnen.
2. **New query** wählen.
3. Den kompletten Inhalt von `supabase/seed.sql` öffnen, kopieren und in den Editor einfügen.
4. **Run** ausführen.
5. Prüfen: Unter **Table Editor** sollten die Tabellen `global_settings`, `user_settings`, `conversations`, `messages`, `user_roles`, `admin_context_files` erscheinen.

## Schritt 3: API-Keys und .env

1. Im Dashboard: **Project Settings** (Zahnrad) → **API**.
2. Notiere:
   - **Project URL** (z.B. `https://xxxxx.supabase.co`)
   - **anon public** Key (unter Project API keys)
3. Erstelle lokal eine `.env` Datei im Projektroot:

```
VITE_SUPABASE_URL=https://DEINE-PROJECT-URL.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=dein-anon-key-hier
VITE_SUPABASE_PROJECT_ID=deine-project-ref-id
```

Die **Project ID** (Reference ID) findest du in der URL des Dashboards:  
`https://supabase.com/dashboard/project/XXXXX` → `XXXXX` ist die Project ID.

## Schritt 4a: URL Configuration (wichtig für Google SSO)

1. Supabase: **Authentication** → **URL Configuration**.
2. **Site URL** setzen:
   - Lokal: `http://localhost:8080`
   - Produktion: `https://deine-domain.de`
3. **Redirect URLs** hinzufügen (jeweils eine Zeile):
   - `http://localhost:8080`
   - `http://localhost:8080/**`
   - `http://localhost:5173` (falls Vite auf anderem Port)
   - Produktions-URL wenn vorhanden
4. Speichern.

## Schritt 4b: Google OAuth

1. [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services** → **Credentials**.
2. **Create Credentials** → **OAuth client ID**.
3. Application type: **Web application**.
4. **Authorized redirect URIs** hinzufügen:
   - `https://DEINE-PROJECT-REF.supabase.co/auth/v1/callback`
   - Für lokale Entwicklung: `http://localhost:8080`
5. **Client ID** und **Client Secret** kopieren.
6. Supabase: **Authentication** → **Providers** → **Google** → Enable.
7. Client ID und Client Secret eintragen und speichern.

## Schritt 5: Edge Function Secrets

1. Supabase: **Project Settings** → **Edge Functions** (oder **API** → Edge Function Secrets).
2. **Add new secret**:
   - Name: `OPENROUTER_API_KEY`
   - Value: dein OpenRouter API-Key von [openrouter.ai](https://openrouter.ai)
3. `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` werden von Supabase automatisch in Edge Functions bereitgestellt – die goae-chat Function nutzt sie für den Zugriff auf `admin_context_files`.

## Schritt 6: Admin-User anlegen

1. Registriere dich in der DocBill-App (E-Mail oder Google).
2. Supabase: **Authentication** → **Users** → deine User-ID (UUID) kopieren.
3. **SQL Editor** → neue Abfrage:

```sql
INSERT INTO public.user_roles (user_id, role)
VALUES ('DEINE-USER-UUID-HIER', 'admin')
ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
```

4. **Run** ausführen.

## Schritt 7: Edge Function deployen

Mit Supabase CLI (nach `npx supabase login`):

```bash
npx supabase link --project-ref DEINE-PROJECT-REF
npx supabase functions deploy goae-chat
```

Ohne CLI: Die Edge Function muss über das Supabase Dashboard oder CI/CD deployt werden. Der Code liegt unter `supabase/functions/goae-chat/`.

## Fertig

Starte die App mit `npm run dev` und prüfe, ob Login, Chat und Einstellungen funktionieren.
