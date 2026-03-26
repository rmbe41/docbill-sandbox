# API: Edge Function `goae-chat`

Kanonische Beschreibung des HTTP-Vertrags und der **SSE-Payloads** mit Feld `type`. Ablauflogik: [PIPELINE.md](./PIPELINE.md).

## Endpoint und Auth

- **URL**
  - Produktion: `POST {VITE_SUPABASE_URL}/functions/v1/goae-chat`
  - Vite Dev: `POST /api/supabase/functions/v1/goae-chat` (Proxy), siehe [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Header**
  - `Content-Type: application/json`
  - `Authorization: Bearer <Supabase JWT>` – wie im Frontend ([`executeGoaeChatRequest`](../src/lib/executeGoaeChatRequest.ts)): publishbarer Anon-Key oder Session-Token des eingeloggten Nutzers.

## Request-Body (JSON)

| Feld | Typ | Beschreibung |
|------|-----|----------------|
| `messages` | Array `{ role, content }` | Chatverlauf; die letzte User-Nachricht wird als Haupteingabe genutzt. |
| `files` | Optional Array `{ name, type, data }` | Base64-Kodierung o. ä. wie vom Client gesendet; fehlt oder leer = kein Upload. |
| `model` | string | OpenRouter-Modell-ID; Default in der Function z. B. `openrouter/free`. |
| `engine_type` | string | `simple` = zweistufige Rechnungsengine; `engine3` = neue Engine-3-Pipeline (siehe PIPELINE.md); sonst 6-Schritt-Pipeline (nur relevant wenn Dateien + nicht Legacy-Service-Billing). |
| `extra_rules` | string | Zusammengefügte globale + nutzerspezifische Regeln. |
| `last_invoice_result` | Optional Objekt | `{ pruefung: ... }` für RAG/Follow-up nach Rechnungsprüfung. |
| `last_service_result` | Optional Objekt | Teilmenge der Service-Billing-Daten (`vorschlaege`, `optimierungen`, `klinischerKontext`, `fachgebiet`). |
| `last_engine3_result` | Optional Objekt | Kompakter Vorläufer für Follow-ups (`modus`, `klinischerKontext`, `positionen`/`optimierungen` mit `ziffer`). |
| `guided_workflow` | Optional `"leistungen_abrechnen"` \| `"rechnung_pruefen"` | Nur zusammen mit `guided_phase` sinnvoll: steuert die **Sammelphase** nach Welcome-Klick (siehe PIPELINE.md). |
| `guided_phase` | Optional `"collect"` | Wenn gesetzt (ohne Dateien, genau **eine** User-Nachricht, kein Assistent im Verlauf): Antwort nur als **Fragemodus** mit Rückfragen zu fehlenden Unterlagen – **keine** Billing-/Rechnungs-Pipeline. Der Client sendet das nur für den ersten Job dieser Konversation. |

## Erfolgsantwort: SSE-Stream

- **Content-Type:** `text/event-stream`
- Jede logische Nachricht: Zeile `data: <JSON>` (optional vorher SSE-Kommentare `: keepalive`).

### JSON-Zeilen mit `type` (DocBill-Events)

| `type` | Zweck |
|--------|--------|
| `pipeline_progress` | Fortschritt 6-Schritt-Rechnungs pipeline: `step`, `totalSteps`, `label`. |
| `service_billing_progress` | Fortschritt Service-Billing: `step`, `totalSteps`, `label`. |
| `pipeline_result` | Strukturiertes Rechnungsergebnis: `data.pruefung`, optional `data.stammdaten`. |
| `service_billing_result` | Strukturierte GOÄ-Vorschläge: `data` = Service-Billing-Result. |
| `pipeline_error` | Pipeline fehlgeschlagen: `error` (Text), optional `code` (z. B. `FREE_MODELS_EXHAUSTED`). |
| `service_billing_error` | Service-Billing fehlgeschlagen: `error`. |
| `engine3_progress` | Engine 3: `step`, `totalSteps`, `label` (5 Schritte). |
| `engine3_result` | Engine 3: strukturiertes Einheitsergebnis (`data`), siehe Typen in [`engine3Result`](../src/lib/engine3Result.ts). |
| `engine3_error` | Engine 3 abgebrochen (z. B. KI-Kontext): `error`, optional `code` (`ENGINE3_KI_CONTEXT`). |

Verarbeitung: [`handleGoaeSseDataLine`](../src/lib/goaeChatSse.ts).

### KI-Kontext (GOÄ, Regeln, Admin)

Antworten basieren auf **mitgeliefertem Kontext**, nicht auf „allgemeinem“ Modellwissen:

- **Katalog & Regeln:** Gebührenzahlen und Ausschlüsse aus dem eingebetteten GOÄ-JSON (inkl. dokumentierter Katalog-Patches in [`goae-catalog-json.ts`](../supabase/functions/goae-chat/goae-catalog-json.ts)); Paragraphen- und Regelblöcke in der Edge Function.
- **`extra_rules`:** Vom Client zusammengefügte globale + nutzerspezifische Regeln (siehe Request-Tabelle).
- **Admin-RAG:** Auszüge aus hochgeladenen Admin-Dateien (u. a. für **GOÄ-Kommentar** / Auslegung), wenn die Suche Treffer liefert; Ziffern aus Anfrage bzw. Rechnung fließen in die Retrieval-Query ein.
- **Engine 3:** Nach dem LLM-Lauf können **deterministische Passes** (z. B. Ausschlüsse, Betragsnachrechnung) das JSON anpassen; das ausgelieferte `engine3_result` ist dieser **aufbereiteten** Fassung verpflichtend – siehe [ARCHITECTURE.md](./ARCHITECTURE.md) Abschnitt „GOÄ- und KI-Kontext“.

### OpenRouter-Streaming (ohne `type`)

Viele Zeilen entsprechen OpenRouter/OpenAI-kompatiblen Chunks, z. B.:

`{ "choices": [ { "delta": { "content": "..." } } ] }`

Der Client hängt `delta.content` an den sichtbaren Assistententext an.

### Sonderfälle im Stream

- Enthält die JSON-Zeile ein oberflächliches `error`-Feld (nicht unser `type`), wertet der Client das als Stream-Fehler und ergänzt einen Fehlerblock im Text ([`goaeChatSse.ts`](../src/lib/goaeChatSse.ts)).

## HTTP-Fehler (kein SSE)

Vor dem Stream kann die Function mit JSON-Fehler antworten, u. a.:

| Situation | Ca. Status | Inhalt |
|-----------|------------|--------|
| `OPENROUTER_API_KEY` fehlt oder leer | 503 | `{ "error": "<Hinweis>" }` |
| JSON-Body ungültig / Verarbeitungsfehler | 500 | `{ "error": "<Message>" }` |

Gateway-Fehler beim Modell: u. a. **429** (Rate Limit), **402** (Credits), **500** mit übersetzter Meldung ([`handleApiError`](../supabase/functions/goae-chat/index.ts)).

Bei ernsthaften Gateway-Problemen kann die Function JSON mit `code: "FREE_MODELS_EXHAUSTED"` liefern (wenn das gewählte Modell ein Free-Modell ist).

## CORS

Die Function hängt Standard-CORS-Header an die Antwort an (`corsHeaders` in [`index.ts`](../supabase/functions/goae-chat/index.ts)).
