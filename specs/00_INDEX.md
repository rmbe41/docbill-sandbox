# DocBill – Spezifikation v1.3 (Modular)

**Version:** 1.3  
**Stand:** April 2026  
**Status:** Final  
**Zielgruppe:** Cursor / Entwicklungsteam  

---

## Aufbau dieser Spezifikation

Die Spec ist in einzelne Dateien aufgeteilt, damit Cursor pro Task nur den relevanten Teil laden muss. Jede Datei ist eigenständig lesbar. Cross-Referenzen sind mit `→ DATEINAME` gekennzeichnet.

**Regel für Cursor:** Lies immer zuerst diese INDEX-Datei. Lade dann nur die Datei(en), die für den aktuellen Task relevant sind. Du musst nicht alle Dateien gleichzeitig laden.

---

## Datei-Übersicht

| Datei | Inhalt | Wann laden? |
|-------|--------|-------------|
| `00_INDEX.md` | Diese Datei. Gesamtübersicht, Tech-Stack, Glossar. | Immer zuerst. |
| `01_DEV_LIFECYCLE.md` | Development Cycles, E2E-Tests, Uptime-Monitoring, Coding Standards, Review-Agent. | Bei Setup, CI/CD, Testing, Monitoring. |
| `02_MODES_AND_PIPELINE.md` | Modi A/B/C, Parsing, PAD-Formate, Analysestruktur (8 Kategorien), Kennzeichnung (Pills), Feedback-System. | Bei Feature-Entwicklung der Kernlogik. |
| `03_UI_UX.md` | Batch-UI, Side-Panel, Faktor-Slider, Begründungsfeld, Streaming, Einwilligung. | Bei Frontend-/UI-Arbeit. |
| `04_INVOICE_AND_EXPORT.md` | Rechnungserstellung, Datenstrukturen, Export-Formate. | Bei Rechnungslogik und Export. |
| `05_KNOWLEDGE_BASE.md` | Wissensbasis-Architektur (JSON lokal vs. Chunking), BÄK-Crawl, Relevanzfilter, Sekundärquellen. | Bei Wissensbasis, RAG, Einstellungen. |
| `06_ARCHITECTURE.md` | System-Architektur, Pseudonymisierung, große Dateien, Chunking, Sessions, EBM-Integration. | Bei Backend-Architektur, Infrastruktur. |
| `07_COMPLIANCE_AND_OPS.md` | DSGVO, Disclaimer, Out of Scope, KPIs, Risiken, offene Fragen. | Bei Compliance, Launch-Vorbereitung. |
| `08_AUTH_AND_TENANCY.md` | Multi-Tenancy, Rollen (Admin/Manager/Viewer), SSO, Datenisolierung. | Bei Auth, User-Management, Rollen. |

---

## Cross-Referenz-Matrix

| Thema | Primär-Datei | Referenziert in |
|-------|-------------|----------------|
| Datenstrukturen (TypeScript-Interfaces) | `02_MODES_AND_PIPELINE.md` | `03_UI_UX.md`, `04_INVOICE_AND_EXPORT.md`, `06_ARCHITECTURE.md` |
| Kennzeichnungssystem (Pills) | `02_MODES_AND_PIPELINE.md` | `03_UI_UX.md`, `04_INVOICE_AND_EXPORT.md` |
| Feedback-System | `02_MODES_AND_PIPELINE.md` | `03_UI_UX.md`, `07_COMPLIANCE_AND_OPS.md` |
| Wissensbasis (JSON lokal vs. Chunking) | `05_KNOWLEDGE_BASE.md` | `06_ARCHITECTURE.md`, `02_MODES_AND_PIPELINE.md` |
| Rollen & Berechtigungen | `08_AUTH_AND_TENANCY.md` | `03_UI_UX.md`, `05_KNOWLEDGE_BASE.md` |
| E2E-Tests | `01_DEV_LIFECYCLE.md` | `07_COMPLIANCE_AND_OPS.md` |
| EBM-Integration | `06_ARCHITECTURE.md` | `02_MODES_AND_PIPELINE.md`, `05_KNOWLEDGE_BASE.md` |
| Batch-Verarbeitung | `03_UI_UX.md` | `06_ARCHITECTURE.md`, `04_INVOICE_AND_EXPORT.md` |

---

## Technologie-Stack

| Komponente | Technologie |
|-----------|------------|
| Frontend | Next.js (React), Tailwind CSS |
| Backend / API | Node.js |
| Datenbank | PostgreSQL |
| Vector-DB | pgvector |
| LLM-Provider | Openrouter (via API) |
| Auth | SSO-Integration (OIDC/SAML) |
| Hosting | Cloud (Vercel), DSGVO-konformer EU-Standort |
| Analytics & Monitoring | PostHog (Self-hosted oder EU Cloud) |
| Error-Tracking | Sentry |

---

## Produktübersicht

DocBill ist ein KI-gestützter Abrechnungs-Assistent für ärztliche Leistungen (GOÄ + EBM). SaaS, browserbasiert. Kein Medizinprodukt.

**Zielgruppen:** Niedergelassene Ärzte (PKV/GKV), Abrechnungsmanager in Praxen/MVZ, Klinik-Abrechnungsabteilungen, Abrechnungsdienstleister.

**Drei Modi:** A (Rechnungsprüfung), B (Fallbeschreibung → Ziffernvorschlag), C (GOÄ-/EBM-Fragestellung).

**Disclaimer (erscheint in jedem Output):** "DocBill ist eine KI und kann Fehler machen. Eine Kontrolle der Ergebnisse ist erforderlich."

---

## Glossar

| Begriff | Definition |
|---------|-----------|
| GOÄ | Gebührenordnung für Ärzte – Privatärztliche Abrechnung |
| EBM | Einheitlicher Bewertungsmaßstab – Vertragsärztliche (GKV) Abrechnung |
| GOP | Gebührenordnungsposition – Einzelne Leistung im EBM |
| BÄK | Bundesärztekammer |
| KBV | Kassenärztliche Bundesvereinigung |
| BA | Bewertungsausschuss (pflegt den EBM) |
| PAD | Praxis-Abrechnungs-Daten – Exportformat aus PVS |
| PVS | Praxis-Verwaltungs-System |
| PKV | Private Krankenversicherung |
| GKV | Gesetzliche Krankenversicherung |
| IGeL | Individuelle Gesundheitsleistungen |
| PII | Personally Identifiable Information |
| RAG | Retrieval Augmented Generation |
| MVZ | Medizinisches Versorgungszentrum |
| SSO | Single Sign-On |
| Schwellenfaktor | GOÄ: Ab Faktor 2,3 ist Begründung erforderlich |
| Orientierungswert | EBM: Bundeseinheitlicher Punktwert (2026: 12,7404 Cent) |
| PostHog | Analytics- und Monitoring-Plattform |
