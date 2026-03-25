# DocBill – Sicherheit und Datenschutz (technischer Überblick)

Kein Rechtsrat; nur grobe technische Einordnung für Entwickler und Betrieb.

## Wo sensible Inhalte verarbeitet werden

- **Browser / Supabase:** Nutzerkonten, Konversationen, Nachrichten, Einstellungen, Admin-Uploads liegen in **eurem Supabase-Projekt** (Region beim Anlegen wählen, z. B. EU).
- **Edge Function `goae-chat`:** Empfängt Nutzertext und optional **Datei-Payloads** (z. B. Rechnung oder Arztbrief) und sendet sie an **OpenRouter**, um LLM-Anfragen auszuführen.

## OpenRouter / LLM

- Die Function nutzt das Secret **`OPENROUTER_API_KEY`** (nur Server-seitig in Supabase, nicht im Frontend einbetten).
- Inhalte der Anfragen können personenbezogene medizinische oder abrechnungsrelevante Daten enthalten, je nach Nutzereingabe und Upload. **Minimierung:** in der Praxis nur notwendige Daten hochladen; Produktprompts fordern u. a. keine Wiedergabe von Personendaten in der Modellantwort (siehe Systemprompts in der Function — nicht den vollen Text hier duplizieren).

## Admin-Kontext

- Dateien in `admin_context_files` werden für kontextuelle Abrufe (RAG) verwendet. Zugriff sollte auf vertrauenswürdige Admins beschränkt sein (Rollen/RLS in Migrationen).

## Client-Geheimnisse

- Im Client sind nur **`VITE_*`-Öffentliche** Supabase-Keys vorgesehen; keine OpenRouter-Keys im Bundle.

## Weiterführend

- Betrieb und incidentartige Diagnose: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- Datenhaltung und RLS: [DATA_MODEL.md](./DATA_MODEL.md)
