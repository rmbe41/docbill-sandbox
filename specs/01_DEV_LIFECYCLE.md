# DocBill Spec – 01 Development Lifecycle

> Teil der modularen Spezifikation v1.3. Siehe `00_INDEX.md` für Gesamtübersicht.

---

## 2. Development Lifecycle

### 2.1 Development Cycles

Die Entwicklung wird in inkrementelle Cycles aufgeteilt. Jeder Cycle liefert ein lauffähiges, testbares Inkrement.

**Cursor soll die konkreten Cycles selbst definieren**, basierend auf folgenden Prinzipien:

**Prinzipien für die Cycle-Planung:**

1. Jeder Cycle muss ein lauffähiges, testbares Inkrement liefern – kein Cycle darf nur "Setup" sein ohne sichtbares Ergebnis für einen Endnutzer.
2. Abhängigkeiten respektieren: Auth und Datenmodell vor Features; einfache Modi vor komplexen; Einzelverarbeitung vor Batch.
3. Frühes Nutzerfeedback ermöglichen: Der einfachste Modus (z.B. Fragestellung) sollte vor komplexeren Modi (Rechnungsprüfung, Batch) kommen.
4. Pro Cycle: E2E-Blackbox-Tests (→ 2.2) und Code-Review-Agent (→ 2.4) müssen bestanden werden, bevor der nächste Cycle startet.
5. Maximale Cycle-Dauer: 3 Wochen. Wenn ein Scope nicht in 3 Wochen passt, aufteilen.

**Beispiel-Reihenfolge als Inspiration (nicht bindend):**

```
Foundation (Auth, DB, JSON-Import) 
→ Einfachster Modus (z.B. Modus C: Fragestellung)
→ Kern-Modus (z.B. Modus A: Rechnungsprüfung)
→ Zweiter Kern-Modus (z.B. Modus B: Fallbeschreibung)
→ Skalierung (Batch & PAD)
→ Wissens-Management (Einstellungen, Chunking, BÄK-Crawl)
→ Feedback & Optimierung (Feedback-Loop, Analytics)
→ Compliance & Launch (Disclaimer, DSGVO, Billing, Polish)
```

Die gesamte Spezifikation definiert das "Was". Cursor bestimmt das "Wie" und "Wann" innerhalb der Cycles.

### 2.2 End-to-End Blackbox-Tests

Nach jedem Cycle wird ein End-to-End (E2E) Blackbox-Test durchgeführt. Kein Unit-Test – die Tests prüfen das System als Ganzes aus der Perspektive eines realen Nutzers.

**Teststrategie:**

Fixture-basiert: Pro Cycle wird ein Set von realistischen Testfällen definiert (Fixtures). Jede Fixture beschreibt eine vollständige Nutzerinteraktion: Input → erwartetes Verhalten → erwartetes Output.

**Fixture-Struktur:**

```yaml
fixture_id: "MODA_001"
name: "Augenarzt-Rechnung mit 5 Positionen"
input:
  type: "pdf_upload"
  file: "fixtures/augenarzt_rechnung_5pos.pdf"
  user_role: "manager"
expected:
  parsing:
    positionen_count: 5
    ziffern: ["1240", "1256", "5855", "6", "75"]
  analyse:
    kategorien_count: 8
    risiko_items_min: 1
    euro_betraege_vorhanden: true
  output:
    contains_disclaimer: true
    response_time_max_ms: 60000
  no_pii_in_llm_request: true
```

**Test-Runner:**

Der E2E-Test-Runner wird als eigenständiger Service implementiert (nicht im Produkt-Code):

```
E2E-Runner → HTTP-Requests an Produkt-API → Prüft Response gegen Fixture
```

Er simuliert echte Browser-Interaktionen (Playwright/Cypress) für UI-Tests und direkte API-Calls für Backend-Tests.

**Regressions-Garantie:** Fixtures aus vorherigen Cycles werden in jedem nachfolgenden Cycle erneut ausgeführt. Ein Cycle gilt nur als bestanden, wenn alle bisherigen Fixtures + die neuen Fixtures grün sind.

**Ergebnis-Reporting:** Nach jedem Testlauf wird ein JSON-Report generiert mit: Fixture-ID, Status (pass/fail), Laufzeit, ggf. Diff zwischen erwartetem und tatsächlichem Output. Dieser Report wird im CI/CD-System (GitHub Actions) archiviert.

### 2.3 Uptime-Monitoring

**Ziel:** System-Uptime ≥ 99,5% (gemessen monatlich).

**Implementierung mit PostHog:**

PostHog wird als zentrale Plattform für Analytics, Monitoring und Feature-Flags eingesetzt.

**Health-Endpoint:**

```
GET /api/health
```

Response:

```json
{
  "status": "healthy",
  "components": {
    "database": "ok",
    "vector_db": "ok",
    "llm_api": "ok",
    "goae_json": { "status": "ok", "version": "2026-Q2" },
    "ebm_json": { "status": "ok", "version": "2026-Q2" }
  },
  "timestamp": "2026-04-17T10:00:00Z",
  "response_time_ms": 42
}
```

**PostHog-Integration:**

| Funktion | Umsetzung über PostHog |
|----------|----------------------|
| Uptime-Tracking | Synthetics-Check (externer Cron alle 60s → `/api/health` → PostHog Custom Event `health_check`) |
| API-Latenz | PostHog Custom Events pro API-Request mit `response_time_ms` Property |
| Error-Tracking | Sentry bleibt für Crashes; PostHog für Error-Rate-Trends über Custom Events |
| LLM-Latenz | Custom Event `llm_request` mit `duration_ms`, `model`, `token_count` |
| Feature-Flags | PostHog Feature Flags für Rollouts (z.B. EBM-Modus, Batch-UI) |
| Uptime-Dashboard | PostHog Dashboard mit 30-Tage-Uptime-%, Latenz-Trends, Error-Rate |

**Alerting (PostHog Actions + Webhooks → Slack):**

| Bedingung | Aktion |
|-----------|--------|
| Health-Check 3× fehlgeschlagen | Slack-Alert (Critical) |
| API P95-Latenz > 120s über 5 Minuten | Slack-Alert (Warning) |
| Error-Rate > 5% über 10 Minuten | Slack-Alert (Critical) |
| LLM-API nicht erreichbar | Slack-Alert + Fallback-Modus |

### 2.4 Coding Standards & Automatisierte Prüfung

**Referenz:** Coding Standards basieren auf [awesome-guidelines](https://github.com/Kristories/awesome-guidelines).

**Relevante Standards für den DocBill-Stack:**

| Sprache/Tool | Standard |
|-------------|----------|
| TypeScript/JavaScript | Airbnb JavaScript Style Guide |
| React | Airbnb React/JSX Style Guide |
| CSS/Tailwind | Airbnb CSS/Sass Styleguide |
| API-Design | Microsoft REST API Guidelines |
| Git | Conventional Commits |
| Allgemein | Clean Code (Robert C. Martin) |

**DocBill-spezifische Regeln:**

```
1. Keine hartcodierten GOÄ-/EBM-Ziffern im Code – immer aus der JSON-Datenbasis lesen
2. Jeder LLM-Prompt muss in einer eigenen, versionierten Prompt-Datei liegen
3. Pseudonymisierungs-Logik darf nicht in Controller-/Route-Dateien stehen
4. Jede API-Route braucht Input-Validation (zod / pydantic)
5. Keine console.log in Production – nur strukturiertes Logging (pino/winston)
6. Fehlermeldungen an den Nutzer müssen in einer zentralen i18n-Datei liegen
7. Keine Patientendaten in Logs – automatischer PII-Filter im Logger
8. Alle Datenbankabfragen über Repository-Pattern (keine Raw-Queries in Controllern)
```

**Automatisierter Review-Agent (CI/CD-Step):**

```
Developer pusht Code → CI Pipeline startet →
  Step 1: Linting (ESLint/Prettier/Ruff)
  Step 2: Type-Check (tsc --noEmit / mypy)
  Step 3: Code-Review-Agent (LLM-basiert)
          Input: Git-Diff des Cycles
          Kontext: DocBill Coding Standards
          Prüft:
           • Einhaltung aller 8 Regeln
           • Architektur-Patterns
           • Sicherheitsrelevante Muster
           • PII-Leak-Risiko in Logs/Responses
          Output: Review-Report (JSON)
  Step 4: E2E Blackbox-Tests (→ 2.2)
```

**Review-Report-Schema:**

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
    pass: boolean;      // true wenn critical === 0
  };
}

interface Finding {
  severity: 'critical' | 'warning' | 'info';
  rule: string;
  file: string;
  line: number;
  message: string;
  suggestion?: string;
}
```

**Gate-Logik:** Der Cycle gilt nur als bestanden, wenn `summary.pass === true` (keine Critical Findings) UND alle E2E-Tests grün sind.
