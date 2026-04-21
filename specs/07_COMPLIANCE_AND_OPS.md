# DocBill Spec – 07 Compliance, KPIs & Risiken

> Teil der modularen Spezifikation v1.3. Siehe `00_INDEX.md` für Gesamtübersicht.
> Cross-Referenzen: → `02_MODES_AND_PIPELINE.md` (Feedback-System), → `01_DEV_LIFECYCLE.md` (E2E-Tests, Monitoring)

---

---

## 9. Datenschutz & Compliance

### 9.1 DSGVO-Maßnahmen

| Anforderung | Umsetzung |
|------------|----------|
| Rechtsgrundlage | Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung) |
| Datenminimierung | Nur notwendige Daten, Pseudonymisierung vor LLM |
| Speicherbegrenzung | PII max. 24h in Processing-Queue, danach gelöscht |
| Auftragsverarbeitung | AV-Vertrag mit LLM-Provider (Anthropic) |
| TOM | Verschlüsselung at rest + in transit, Zugriffskontrolle |
| Auskunftsrecht (Art. 15) | Export aller nutzerbezogenen Daten über Einstellungen |
| Löschrecht (Art. 17) | Nutzer kann alle Daten über Einstellungen löschen |

### 9.2 LLM-Datenschutz

Kein LLM-Training auf Nutzerdaten. Pseudonymisierte Daten werden nur transient verarbeitet. Der LLM-Provider speichert keine Prompts/Responses.

---

## 10. Out of Scope (v1.3)

- Rechtliche Beratung oder Haftungsübernahme
- Schnittstelle zu PKV-Systemen für automatische Einreichung
- KI-basierte Diagnoseunterstützung
- Tiefe PVS-Integration (außer PAD-Import/Export)
- Multi-Sprach-Unterstützung (nur Deutsch)
- Stationäre Abrechnung (DRG/PEPP)

---

## 11. Disclaimer

**Einziger Disclaimer (erscheint in jedem Output):**

"DocBill ist eine KI und kann Fehler machen. Eine Kontrolle der Ergebnisse ist erforderlich."

Dieser Disclaimer erscheint: am Ende jeder Analyse (Modus A/B/C), im Footer jedes Rechnungsentwurfs, im Export (PDF, CSV), und in der Batch-Zusammenfassung.

---

## 12. Erfolgskriterien (KPIs)

| KPI | Zielwert (12 Monate) | Messmethode |
|-----|---------------------|-------------|
| PKV-Kürzungsquote bei geprüften Rechnungen | ↓ 40% gegenüber Baseline | Nutzer-Reporting (opt-in) |
| Nutzer-Zeitersparnis pro Rechnung | ≥ 5 Minuten | Time-on-Task-Messung |
| Begründungsqualität (Nutzer-Rating) | ≥ 4,2 / 5,0 | Feedback-System (→ 4.8) |
| Vorschlags-Annahmerate | ≥ 80% | Annehmen/Ablehnen-Tracking |
| False-Positive-Rate | < 5% | Feedback "Ziffer(n) falsch" |
| Nutzerbindung nach 3 Monaten | ≥ 70% | Login-Daten |
| Daumen-hoch-Ratio | ≥ 85% | Feedback-System |
| Antwortzeit P95 (Modus C) | < 30s | PostHog Custom Events |
| Antwortzeit P95 (Modus A/B) | < 60s | PostHog Custom Events |
| System-Uptime | ≥ 99,5% | PostHog Monitoring (→ 2.3) |
| E2E-Test-Bestehensrate | 100% pro Cycle | CI/CD-Reports (→ 2.2) |
| Code-Review-Agent: 0 Critical Findings | 100% pro Cycle | CI/CD-Reports (→ 2.4) |


---

## 14. Risiken & Mitigationen

| Risiko | Wahrscheinlichkeit | Mitigation |
|--------|-------------------|-----------|
| Haftungsrisiko bei Fehlinformation | Hoch | Disclaimer in jedem Output |
| Datenschutzverletzung | Mittel | Pseudonymisierungs-Pipeline, kein LLM-Training, AV-Vertrag |
| LLM halluziniert Ziffer | Mittel | Post-Validierung gegen GOÄ/EBM-JSON |
| PKV-Anfechtung KI-Begründungen | Niedrig | Nutzer muss aktiv annehmen, keine automatische Einreichung |
| Wissensbasis veraltet | Niedrig | Wöchentlicher BÄK-/BA-Crawl, Healthcheck, Versionierung |
| OCR-Fehler | Mittel | Confidence-Anzeige, Nutzer-Verifikation |
| Große Dateien überlasten System | Mittel | Queue-basierte Verarbeitung, Limits, Timeout-Strategie |
| EBM-Quartals-Update verpasst | Niedrig | Kalender-Reminder, Healthcheck prüft Version |
| BÄK-Crawl schlägt fehl | Niedrig | Alert an Admin, manuelle Nacharbeit |

---

## 15. Offene Fragen

| Frage | Status |
|-------|--------|
| Lizenzmodell (Flatrate vs. volumenbasiert) | Offen |
| Kommentarliteratur-Lizenz (Brück/Hoffmann) | Offen – Verlagsanfrage nötig |
| EBM-JSON-Erstellung (Qualität der automatischen Konvertierung) | Test mit Q2/2026 EBM-PDF nötig |
| PVS-Hersteller-Kooperationen für PAD-Formate | Offen |

