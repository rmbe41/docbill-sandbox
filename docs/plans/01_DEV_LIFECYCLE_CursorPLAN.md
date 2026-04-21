# Cycle 01 – Development Lifecycle, E2E, Monitoring & Quality Gates

**Spec-Quelle:** `specs/01_DEV_LIFECYCLE.md` (Abschnitt 2, vollständig)  
**Referenz:** `specs/00_INDEX.md` (Tech-Stack, E2E-Verknüpfung)  
**Status:** Plan (kein produktiver Code in diesem Schritt)  
**Cycle-Nummer (Review-Report):** `1`

---

## Kontext-Analyse (Schritt 1)

### 1.1 `specs/00_INDEX.md` (Kurzfassung)

- Modulare Spec v1.3; `01_DEV_LIFECYCLE.md` zuständig für **Setup, CI/CD, Testing, Monitoring**.
- Ziel-Stack laut Index: **Next.js (React)**, Tailwind, Node, **PostgreSQL**, **pgvector**, **Openrouter**, SSO, Vercel, **PostHog**, **Sentry**.
- Cross-Ref: E2E-Tests primär in `01`, KPI „E2E 100 % pro Cycle“ in `07_COMPLIANCE_AND_OPS.md`.

### 1.2 Weitere Spec-Dateien (Relevanz für Cycle 01)

| Datei                      | Bezug zu Cycle 01                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `02`–`08`                  | Keine fachlichen Features in Cycle 01; spätere Cycles müssen **E2E-Fixtures** und **Regression** aus `01` §2.2 erfüllen. |
| `07_COMPLIANCE_AND_OPS.md` | KPI: E2E-Test-Bestehensrate **100 %** pro Cycle; schließt an Gate-Logik §2.4 an.                                         |

### 1.3 Ist-Zustand der Codebase (Abgleich)

| Thema                 | Befund                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Frontend**          | **Vite + React** (`vite`, `src/main.tsx`), **nicht** Next.js – Abweichung von `00_INDEX.md`.                      |
| **Backend**           | **Supabase Edge Functions** (`supabase/functions/*`, Deno), u. a. `goae-chat`, `feedback`, …                      |
| **Tests**             | **Vitest** (`npm run test`) – Unit-/Integrationsnähe; **kein** separater E2E-Blackbox-Runner gemäß §2.2.          |
| **CI**                | Nur `.github/workflows/goae-update.yml` (wöchentlicher GOÄ-Katalog); **kein** PR-Lint/Typecheck/E2E/Review-Agent. |
| **`GET /api/health`** | **Nicht** vorhanden (Spec §2.3); kein gleichwertiger zentraler Health-Endpunkt im Repo-Scan.                      |
| **PostHog / Sentry**  | Keine Dependencies/Integration im `package.json` gefunden.                                                        |
| **Lint**              | ESLint 9 + `typescript-eslint` (`eslint.config.js`); **kein** `tsc`-Script in CI.                                 |
| **Logging**           | Edge Functions nutzen u. a. `console.log` (u. a. Instrumentation) – Konflikt zu §2.4 Regel 5/7 (Zielbild).        |

**Fazit:** Cycle 01 implementiert die **Spezifikation aus `01_DEV_LIFECYCLE.md`** als **Plattform-/Qualitätsschicht** und mappt **`/api/health`** bewusst auf die **reale Architektur** (siehe Architecture).

---

## Mapping: 100 % Abdeckung `specs/01_DEV_LIFECYCLE.md`

| Spec-Abschnitt                                                                                                                                | In diesem Plan                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **§2.1** Prinzipien 1–5, Beispiel-Reihenfolge                                                                                                 | Abschnitt [Scope](#scope) + [Decisions](#decisions-required) + [DoD](#definition-of-done-dod)                                                      |
| **§2.2** E2E Blackbox, Fixtures, Runner, Playwright/Cypress, Regression, JSON-Report, CI-Archiv                                               | [Scope](#scope), [E2E-Fixtures](#e2e-fixtures), [File Changes](#file-changes), [Tech Stack](#tech-stack--patterns), [DoD](#definition-of-done-dod) |
| **§2.3** Uptime ≥99,5 %, PostHog-Tabelle, Health-JSON, Alerting-Tabelle                                                                       | [Scope](#scope), [Architecture](#architecture), [Tech Stack](#tech-stack--patterns), [Decisions](#decisions-required)                              |
| **§2.4** awesome-guidelines, Standard-Tabelle, 8 Regeln, CI-Pipeline (ESLint/Prettier/Ruff, tsc/mypy, Review-Agent, E2E), Review-Schema, Gate | [Scope](#scope), [Tech Stack](#tech-stack--patterns), [File Changes](#file-changes), [DoD](#definition-of-done-dod)                                |

---

## Scope

Cycle 01 liefert ein **lauffähiges, testbares Inkrement** gemäß §2.1 Prinzip 1. „Nur Setup“ ohne sichtbares Ergebnis ist unzulässig; daher mindestens **ein nutzer- oder betriebsrelevant sichtbares Ergebnis**, z. B.:

- eine **Status-/System-Seite** in der SPA (z. B. `/status` oder `/health`) die den **Health-Status** lesbar anzeigt **oder**
- ein **öffentlich erreichbarer Health-Endpunkt**, der von einem Bookmark/Monitoring genutzt werden kann,

zusätzlich zur technischen Infrastruktur unten.

### §2.1 – Cycle-Planungsprinzipien (operativ verankern)

Die folgenden Regeln aus der Spec werden **als Arbeitsregeln** für alle folgenden Cycles dokumentiert (z. B. in `docs/plans/README.md` oder Kurzabschnitt hier + Verweis):

1. Jedes Inkrement: lauffähig und testbar; kein reines Setup ohne **Endnutzer-/Betriebs-Nutzen**.
2. **Abhängigkeiten:** Auth & Datenmodell vor Features; einfache Modi vor komplexen; Einzelverarbeitung vor Batch.
3. **Frühes Feedback:** einfachster Modus (z. B. Fragestellung) vor komplexeren.
4. **Pro Cycle:** §2.2 E2E-Blackbox **und** §2.4 Review-Agent **bestanden**, bevor der nächste Cycle startet.
5. **Max. 3 Wochen** pro Cycle; sonst Aufteilen.

**Beispiel-Reihenfolge** (§2.1, nicht bindend): als **Roadmap-Hinweis** im Plan dokumentiert – Foundation → Modus C → A → B → Batch/PAD → Wissens-Management → Feedback/Analytics → Compliance/Launch.

### §2.2 – End-to-End Blackbox-Tests

- **Kein Ersatz** durch Unit-Tests: Blackbox aus **Nutzer-/Systemperspektive**.
- **Fixture-basiert:** YAML-Struktur wie in der Spec (Beispiel `MODA_001`); pro Cycle wächst das Fixture-Set.
- **E2E-Runner** als **eigenständiger Prozess/Package** (nicht im Produkt-Bundle): `E2E-Runner → HTTP → Produkt-API → Assertion gegen Fixture`.
- **UI:** Simulation via **Playwright oder Cypress** (Spec); **Backend:** direkte API-Calls.
- **Regression:** alle Fixtures **vorheriger** Cycles laufen in **jedem** späteren Lauf mit; Cycle nur „bestanden“, wenn **alle** grün.
- **Report:** JSON mit **Fixture-ID**, **Status (pass/fail)**, **Laufzeit**, **optional Diff** (erwartet vs. tatsächlich).
- **CI:** Report als **Artefakt** in GitHub Actions archivieren.

**Cycle-01-Minimum:** Runner + **mindestens drei** realistische Fixtures (siehe [E2E-Fixtures](#e2e-fixtures)); keine vollständigen `MODA_*`-Szenarien nötig, solange Format und Pipeline der Spec entsprechen (MODA kommt mit Produkt-Cycles).

### §2.3 – Uptime-Monitoring

- **Ziel:** monatliche System-Uptime **≥ 99,5 %** (Messung über Monitoring/Synthetics – vollständige Erfüllung ist Betriebsthema, **Grundlage** in Cycle 01).
- **PostHog** als zentrale Plattform für Analytics, Monitoring, Feature-Flags (Spec).
- **`GET /api/health`** mit Response-Struktur wie in der Spec (JSON mit `status`, `components`, `timestamp`, `response_time_ms`).

**PostHog-Integration (vollständige Spec-Tabelle):**

| Funktion         | Umsetzung                                                              |
| ---------------- | ---------------------------------------------------------------------- |
| Uptime-Tracking  | Externer Cron **~60 s** → Health-URL → Custom Event **`health_check`** |
| API-Latenz       | Custom Events **pro API-Request** mit Property **`response_time_ms`**  |
| Error-Tracking   | **Sentry:** Crashes; **PostHog:** Error-Rate-Trends via Custom Events  |
| LLM-Latenz       | Event **`llm_request`** mit `duration_ms`, `model`, `token_count`      |
| Feature-Flags    | PostHog Feature Flags (z. B. EBM-Modus, Batch-UI)                      |
| Uptime-Dashboard | PostHog Dashboard: **30-Tage-Uptime-%**, Latenz-Trends, Error-Rate     |

**Alerting (PostHog Actions + Webhooks → Slack) – vollständig:**

| Bedingung                                     | Aktion                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Health-Check **3×** fehlgeschlagen            | Slack **Critical**                                                                    |
| API **P95-Latenz > 120 s** über **5 Minuten** | Slack **Warning**                                                                     |
| **Error-Rate > 5 %** über **10 Minuten**      | Slack **Critical**                                                                    |
| **LLM-API nicht erreichbar**                  | Slack **+** **Fallback-Modus** (Spec; Fallback-Verhalten mit Product-Owner abstimmen) |

**Health-`components` (Spec):** `database`, `vector_db`, `llm_api`, `goae_json` `{ status, version }`, `ebm_json` `{ status, version }`. Nicht verfügbare Komponenten: einheitlich dokumentieren (`ok` | `degraded` | `unknown` | `error` – **Decision**, Schema stabil halten).

### §2.4 – Coding Standards & Automatisierte Prüfung

- **Referenz:** [awesome-guidelines](https://github.com/Kristories/awesome-guidelines).

**Standards-Tabelle (Spec):**

| Bereich               | Standard                      |
| --------------------- | ----------------------------- |
| TypeScript/JavaScript | Airbnb JavaScript Style Guide |
| React                 | Airbnb React/JSX Style Guide  |
| CSS/Tailwind          | Airbnb CSS/Sass Styleguide    |
| API-Design            | Microsoft REST API Guidelines |
| Git                   | Conventional Commits          |
| Allgemein             | Clean Code                    |

**DocBill-Regeln 1–8 (Review-Agent und manuelle Reviews müssen sie kennen):**

1. Keine hartcodierten GOÄ-/EBM-Ziffern – immer aus JSON-Datenbasis.
2. Jeder LLM-Prompt in **eigener, versionierter** Prompt-Datei.
3. Pseudonymisierung **nicht** in Controller-/Route-Dateien.
4. Jede API-Route: **Input-Validation** (zod / pydantic → in TS-Codebase: **zod**).
5. Keine `console.log` in Production – **pino/winston** (bzw. Deno-Äquivalent in Edge Functions).
6. Nutzer-Fehlermeldungen: **zentrale i18n-Datei**.
7. Keine Patientendaten in Logs – **PII-Filter** im Logger.
8. DB-Zugriffe: **Repository-Pattern**, keine Raw-Queries in Controllern.

**CI-Pipeline (Spec):**

1. **Linting:** ESLint / Prettier / **Ruff** (Ruff nur relevant, falls Python-Code hinzukommt; sonst **TS-Äquivalent** dokumentieren, z. B. „nur ESLint“ + später Ruff für `scripts/*.py`).
2. **Type-Check:** `tsc --noEmit` / **mypy** (mypy bei reinem TS: **entfällt**; explizit in Pipeline-Kommentar).
3. **Code-Review-Agent (LLM):** Input = **Git-Diff**; Kontext = DocBill-Standards; Prüfung: **alle 8 Regeln**, Architektur, Sicherheit, **PII-Leak** in Logs/Responses; Output = **JSON** nach untenstehendem Schema.
4. **E2E Blackbox-Tests** (§2.2).

**Review-Report (Spec, wörtlich als Zielschema):**

```typescript
interface CodeReviewReport {
  cycle: number;
  timestamp: string;
  files_reviewed: number;
  findings: Finding[];
  summary: {
    critical: number;
    warning: number;
    info: number;
    pass: boolean; // true wenn critical === 0
  };
}

interface Finding {
  severity: "critical" | "warning" | "info";
  rule: string;
  file: string;
  line: number;
  message: string;
  suggestion?: string;
}
```

**Gate-Logik (Spec):** Cycle bestanden **gdw.** `summary.pass === true` (**keine Critical Findings**) **und** alle E2E-Tests grün.

---

## Decisions Required

| ID  | Thema                                     | Optionen / Fragen                                                                                                                                           |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Health-URL vs. Spec `GET /api/health`** | A) Supabase Edge Function `health` unter Project-URL, B) Reverse-Proxy mappt `/api/health` → Function, C) später Next.js – **Schema** bleibt spec-konform.  |
| D2  | **E2E-Ziel**                              | Staging-Deployment vs. `supabase start` + gebaute SPA; Secrets/Service-Role nur in geschützten Jobs.                                                        |
| D3  | **Review-Agent**                          | OpenRouter (Index) vs. anderer LLM; Modell; **Budget**; nur `main`/interne Branches wenn Secrets kritisch.                                                  |
| D4  | **Gate-Härte**                            | Ab Cycle 01: Review-Agent **blockiert** bei Critical vs. **Report-only** in Sprint 1 – Spec verlangt Gate; Default: **blockieren**, wenn Secrets verfügbar. |
| D5  | **PostHog/Sentry**                        | EU Cloud vs. Self-Host; DSN/Keys in GitHub Environments.                                                                                                    |
| D6  | **Komponenten ohne Infrastruktur**        | `vector_db` / `ebm_json`: `unknown` bis Cycle mit pgvector/EBM-JSON?                                                                                        |
| D7  | **Fallback bei LLM down**                 | Nur Alert + Health `llm_api: error` oder reduzierte Produktfunktion – Product-Owner.                                                                        |
| D8  | **Airbnb-Configs**                        | Vollständige eslint-config-airbnb vs. schrittweise (Konflikte mit bestehendem ESLint 9 flat config).                                                        |

---

## Architecture

### Bestehend (Ist)

```
Vite SPA (src/) ──HTTPS──► Supabase (Auth, DB, Storage)
                              └── Edge Functions (goae-chat, feedback, …)
Vitest: src/test, benchmarks/
```

### Ziel-Erweiterungen (Cycle 01)

1. **E2E-Schicht:** separates Node-Package/Ordner, **keine** Kopplung an Vite-Bundle; spricht **HTTP** gegen deployte oder lokale URLs.
2. **Health:** ein **kanonischer** JSON-Body (Spec §2.3); Implementierung **edge-nah** (Deno) oder hinter Proxy mit exaktem Pfad `/api/health` falls D1 so entschieden.
3. **Observability:** PostHog **Server-** und ggf. **Client-Init**; `health_check` nach erfolgreichem/fehlgeschlagenem Check; Sentry SDK (mindestens **Vite-Client** und/oder **Edge** – Decision).
4. **CI als Gatekeeper:** PR-Pipeline mit **Lint → typecheck → review-agent → e2e**; Artefakte: Review-JSON + E2E-JSON-Report.
5. **PII/Logging:** Roadmap: Edge Functions von rohem `console.log` zu strukturiertem, gefiltertem Logging (vollständige Erfüllung Regel 5/7 kann über Cycle 01 hinausgehen; **DoD** definiert Mindeststand).

### Abweichung `00_INDEX` (Next.js)

- Dokumentiert: langfristige Angleichung an Index-Stack optional; Cycle 01 liefert **spezifikationskonformes Verhalten** (Health, E2E, Gates), nicht zwingend Next.js-Migration.

---

## File Changes

### Neu (vorgeschlagen)

| Pfad                                        | Zweck                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `docs/plans/01_DEV_LIFECYCLE_CursorPLAN.md` | Dieser Plan                                                                                  |
| `docs/plans/README.md`                      | Kurz: Cycle-Reihenfolge, Verweis auf §2.1 Prinzipien (optional, kann in diesem File bleiben) |
| `e2e-runner/package.json`                   | E2E-Runner (oder Monorepo-Root-Workspace – Decision)                                         |
| `e2e-runner/src/index.ts`                   | CLI: Fixtures laden, ausführen, Report schreiben                                             |
| `e2e-runner/src/fixtures/*.yaml`            | Initiale Fixtures (siehe unten)                                                              |
| `e2e-runner/src/report/schema.ts`           | Report-Typen (Fixture-Ergebnis + optional Review-JSON-Validierung)                           |
| `scripts/review-agent/index.ts`             | Diff lesen, LLM aufrufen, `CodeReviewReport` JSON ausgeben                                   |
| `.github/workflows/ci.yml`                  | Lint, `tsc`, Review-Agent, E2E, `upload-artifact`                                            |
| `supabase/functions/health/index.ts`        | Health-Endpoint (wenn D1 = Edge)                                                             |
| `src/pages/Status.tsx` + Router-Eintrag     | Sichtbare Status-UI (Scope Prinzip 1)                                                        |
| `src/lib/observability/posthog.ts`          | PostHog-Init (Client) – stub bis Keys da                                                     |

### Geändert

| Pfad                                        | Änderung                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `package.json`                              | Scripts: `typecheck`, `e2e`, `ci`; ggf. `workspaces`; Dependencies: `yaml`, `posthog-js`/`posthog-node`, `@sentry/*` (nach Decision) |
| `eslint.config.js`                          | Schritt Richtung Airbnb-Kompatibilität oder dokumentierte Abweichung + gezielte Regeln (z. B. no-console in `src/` production paths) |
| `supabase/config.toml`                      | Function `health` deploybar                                                                                                          |
| Ausgewählte `supabase/functions/*/index.ts` | Logging nur nach klarem Teil-Scope (DoD); nicht „alles auf einmal“ ohne Freigabe                                                     |

---

## Dependencies

- **GitHub:** Actions aktiviert; Secrets: `OPENROUTER_API_KEY` (oder gleichwertig), `POSTHOG_API_KEY`, ggf. `SENTRY_DSN`, `SUPABASE_*` für E2E gegen Remote.
- **Deploy:** erreichbare **Base-URL** für E2E (Staging oder lokal dokumentiert mit `act`/Runner-Limitierungen).
- **Supabase-Projekt** mit Edge Functions deploybar.
- **Kein** Abschluss von Modus A/B/C nötig für Cycle 01.

---

## Tech Stack & Patterns

| Bereich                | Spec / Wahl                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Lint**               | ESLint + Prettier; Airbnb über `eslint-config-airbnb` **oder** `typescript-eslint` + ausgewählte Airbnb-Regeln (D8).             |
| **Typecheck**          | `tsc --noEmit` (`tsconfig.app.json` + Functions-TS wenn separat).                                                                |
| **Python-Tools in CI** | Ruff/mypy nur wenn Repo Python nutzt; sonst **N/A** im Workflow-Kommentar (100 %-Abdeckung der Spec ohne falsche Tool-Vorgabe).  |
| **Validation**         | **zod** (bereits im Projekt) für neue API-Routen.                                                                                |
| **Logging (Zielbild)** | **pino** oder **winston** in Node-Tools; Deno: `console.log` mit strukturiertem JSON + Redaction – bis vollständiger PII-Filter. |
| **i18n**               | Erste zentrale Datei (z. B. `src/messages/de.ts` oder JSON) – Mindeststrings für Health-Fehler/Status.                           |
| **Repository-Pattern** | Bei neuen DB-Zugriffen in Cycle 01; Refactor Altcode nur wenn im Scope.                                                          |
| **E2E**                | YAML + Node 20; später **Playwright** installierbar für UI-Fixtures.                                                             |
| **PostHog**            | `health_check`, später `api_request`, `llm_request`, Feature-Flag-Reads.                                                         |
| **Sentry**             | Crash-Tracking; PostHog für Trend-Events laut Spec-Tabelle.                                                                      |

**Keine Schema-Neu-DB für Cycle 01** zwingend; Health kann **stateless** sein. Optional: kleine Tabelle `health_check_log` **nicht** in Spec – nur wenn Product will.

---

## E2E-Fixtures

Format **analog** `specs/01_DEV_LIFECYCLE.md` §2.2. Die folgenden IDs sind **Cycle-01-Minimum** (Pfade/URLs an D1/D2 anpassen).

### `HEALTH_001`

```yaml
fixture_id: "HEALTH_001"
name: "Health liefert Spec-JSON und GOÄ-Version"
input:
  type: "http_get"
  path: "/api/health"
  # base_url: aus Umgebungsvariable E2E_BASE_URL
expected:
  output:
    status_code: 200
    json_path:
      status: "healthy"
      components.goae_json.status: "ok"
    response_time_max_ms: 15000
  no_pii_in_llm_request: true
```

### `E2E_GATE_001`

```yaml
fixture_id: "E2E_GATE_001"
name: "Runner schreibt JSON-Report mit allen Fixture-IDs und pass/fail"
input:
  type: "runner_meta"
expected:
  output:
    report_fields:
      - "fixture_id"
      - "status"
      - "duration_ms"
    diff_optional: true
```

### `API_AUTH_001` (Blackbox gegen bestehende API)

```yaml
fixture_id: "API_AUTH_001"
name: "Geschützte Edge Function ohne Credentials -> 401"
input:
  type: "http_get"
  path: "/functions/v1/goae-chat"
  headers: {}
expected:
  output:
    status_code: 401
```

**Hinweis:** Exakter Pfad an Supabase-Projekt-URL anpassen. Dient der **Blackbox**-Charakteristik §2.2; keine Unit-Tests.

**Regression:** Zukünftige Cycles fügen u. a. `MODA_*`, `MODC_*` hinzu; alle vorherigen Fixtures bleiben Pflicht.

---

## Definition of Done (DoD)

Messbar und an Spec gekoppelt:

### §2.1

- [ ] Dokumentierter Verweis auf **alle 5 Prinzipien** und die **Beispiel-Reihenfolge** als Roadmap-Hinweis für Folge-Cycles.
- [ ] **Sichtbares Inkrement:** Status-UI und/oder bookmarkbarer Health – nicht „nur interne Scripts ohne UI/URL“.

### §2.2

- [ ] E2E-Runner **außerhalb** des Produkt-Bundles; **HTTP**-basiert; **YAML-Fixtures**.
- [ ] JSON-Report mit **Fixture-ID**, **pass/fail**, **Laufzeit**, optional **Diff**.
- [ ] CI archiviert Report (GitHub Actions **artifact**).
- [ ] **Regression**-Mechanik dokumentiert (alle alten Fixtures im Lauf).

### §2.3

- [ ] **`GET /api/health`** (oder dokumentiert gleichwertiger Pfad + Proxy) mit Response gemäß Spec (**`status`, `components`, `timestamp`, `response_time_ms`**).
- [ ] PostHog: **`health_check`** bei Synthetics/Runner; Roadmap/Implementierung für **API-Latenz-Events**, **`llm_request`**, **Feature-Flags**, **Dashboard** (mindestens **health_check** + ein **Dashboard-Entwurf** in PostHog oder exportierbare Query-Definition).
- [ ] Sentry **oder** dokumentierter Sprint-2-Schritt (Decision D5) – Spec will Sentry für Crashes.
- [ ] **Alerting-Regeln** in PostHog/Slack **konfiguriert** (oder Issue mit exakter Checkliste der vier Bedingungen aus Spec), inkl. **LLM nicht erreichbar** + **Fallback**-Entscheidung D7.

### §2.4

- [ ] CI: **Step 1** Lint (+ Prettier wo aktiv); **Step 2** `tsc --noEmit`; **Step 3** Review-Agent mit **CodeReviewReport**-JSON; **Step 4** E2E.
- [ ] Review-Agent prüft explizit die **8 DocBill-Regeln** + PII + Architektur (Prompt-Text referenziert Regeln).
- [ ] **Gate:** `summary.pass === true` **und** alle E2E grün (Spec).
- [ ] Standards aus Tabelle **nachweislich** adressiert (eslint-extend oder **ADR**: bewusste Abweichung mit Begründung).

### Allgemein

- [ ] `npm run lint` und `npm run typecheck` (neu) **grün** im Default-Branch-Workflow.
- [ ] Keine neuen **hartcodierten** GOÄ-Ziffern in neuem Code (Regel 1).

---

## Offene Punkte (technische Ergänzung)

- **Monorepo:** `e2e-runner` als Workspace-Package vs. Unterordner mit eigenem `package.json` – Build-Reihenfolge in CI.
- **Review-Agent:** Zeilennummern aus Diff **approximativ** – `Finding.line` kann Parser-Limit haben; in Report **Hinweis** „line: best effort“.
- **Playwright/Cypress:** Cycle 01 kann API-only E2E liefern; Browser-E2E sobald kritische UI-Flows existieren – Spec erlaubt beides, **Runner-Architektur** soll beides vorbereiten.

---

**Ende Plan Cycle 01** — Freigabe durch Product Owner vor Start der Implementierung und vor Cycle 02.
