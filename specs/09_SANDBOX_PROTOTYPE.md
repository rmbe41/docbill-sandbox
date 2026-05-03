# DocBill Sandbox – Prototyp-Spezifikation (v0.2)

> Teil der modularen Spezifikation. Siehe `00_INDEX.md` für Gesamtübersicht.  
> Cross-Referenzen: → `03_UI_UX.md` (UI-Stil, Side-Panel-Muster), → `04_INVOICE_AND_EXPORT.md` (Rechnungskonzepte), → `06_ARCHITECTURE.md` (EBM-/GOÄ-Kontext im Produkt).

---

## 1. Zweck und Abgrenzung

### 1.1 Was die Sandbox ist

Klickbarer **Prototyp** der DocBill-Plattform **im Bereich ambulanter Haus- und Facharztversorgung** auf **ausschließlich synthetischen Daten**. Sie demonstriert den Kern-Workflow:

**Dokumentation anlegen → Abrechnungsvorschlag → Review → Versand → Übersicht über alle Rechnungen.**

- Keine echten Patientendaten, kein Produktiv-Backend, keine KV-/TI-Anbindung.
- **Visuelle Richtung:** Operator-orientierte Oberfläche (tabellenlastig, viel Weißraum, neutrale Typografie, ohne Marketing-Chrome).

### 1.2 Nicht-Ziele (v0.2)

Auth, echte APIs, vollständiger offizieller Code-Katalog als Produktionsquelle, KIM/TI, Mehrbenutzer, Rollen, Audit-Log, Reports/Analytics, eigenständige Patientenverwaltungs-Section, mobile Optimierung, i18n, verbindliche ICD-/GOÄ-/EBM-Validierung gegen Gesetzestext.

---

## 2. Festgelegte Produktentscheidungen (Stand Spec)

| Thema | Entscheidung |
|--------|----------------|
| **GOÄ und EBM im Vorschlag** | Im Review werden **beide Welten** angezeigt, auch **bei Kostenträger GKV**: klar getrennte Abschnitte (z. B. „EBM (GKV-Leistungen)“ und „GOÄ (Referenz / privatärztliche Parallelrechnung)“) mit verständlichen Kurzlabels, damit der Prototyp nicht wie ein fachlicher Widerspruch wirkt. |
| **Kanban-Interaktion** | **Kein Drag-and-Drop.** Spalten sind rein lesend gruppiert; Statuswechsel nur über **explizite Aktionen** (Buttons, Menüs, modale Bestätigungen). |
| **Quelle der Kodierung** | Keine echte KI-Inferenz und kein Keyword-Matching als „Wahrheit“. **Genau 50 synthetische Testfälle** in JSON definieren Doku, ICD, GOÄ- und EBM-Zeilen, Begründungen und optional **Zuordnungen zu Textstellen**. Ein kurzer Ladezustand (~1,5 s) ist **reines UX-Theater**; danach wird der **Testfall** zur gewählten Case-ID geladen. |
| **Katalogbezug** | Ziffern-**Labels** und Plausibilität werden aus den im Repo vorhandenen Snapshots abgeleitet: mindestens `src/data/goae-catalog-v2.json` und `src/data/ebm-catalog-2026-q2.json` (oder gleichwertige Sandbox-Teilmengen). Im Testfall verwendete Codes müssen im Snapshot existieren oder in einem validierten Katalogausschnitt dokumentiert sein. |

---

## 3. Scope v0.2 (Kern-Features)

1. **Board „Rechnungen“** — Spalten nach Status, Karten kompakt, Klick öffnet Slide-Over mit Timeline und Details; **Freitextsuche** in der Übersichtszeile (rechts); Spaltenkopf mit **Anzahl und Summe (€)**.
2. **Dokumentationen** — Tabelle aller Dokus mit Status und Zeilenaktionen (u. a. „Rechnung erstellen“).
3. **Neue Dokumentation** — Primärer CTA im Header, Formular mit Tabs/Steps (Patient, Behandlung, Vorschau & Speichern), **Testdaten-Generator** auf Basis der Testfall-/Template-Struktur.

**Durchgängiger Flow:** Speichern & Rechnung vorschlagen → Review (Split-Screen) → Freigeben → Versand (ohne echte Übermittlung) → Karte im Board unter **„Eingereicht“** wiederfinden.

Alles andere (Settings, Reports, eigenständige Patientenpflege) ist out of scope für v0.2.

---

## 4. Informationsarchitektur

### 4.1 Navigation (ohne Sidebar)

Horizontale Hauptnavigation unterhalb der **Hinweiszeile** („Beispieldaten …“): links **Logo** und Kennzeichnung **DocBill Sandbox**, rechtsbündig **Übersicht** (Board) und ein einzelner Button **Neue Dokumentation**. Kein Eintrag „Dokumentationen“ in der Nav — die Route `/sandbox/dokumentationen` bleibt für Deep-Links/Erwähnungen aus Flows erhalten.

| Eintrag | Rolle |
|---------|--------|
| **Übersicht** | Standard-Landing; Kanban-artiges Board (ohne DnD). |
| **Neue Dokumentation** | Primärer CTA (nur dieses eine Button-Element im Shell). |

Die Seite „Dokumentationen“ ist weiterhin unter ihrer URL erreichbar (z. B. nach „Speichern als Entwurf“), erscheint aber nicht in der Hauptnavigation.

### 4.2 Top-Bar

- Hinweiszeile: **„Beispieldaten — Zurücksetzen lädt den Anfangszustand neu.“** — mit `bg-muted`/`border-border` o. ä. theme-kompatibel (Hell/Dunkel).
- **Reset**-Button: leert Anwendungsstate, lädt Seed neu (siehe Persistenz).
- Statisches Praxis-Profil, z. B. „Dr. Müller, Allgemeinmedizin“.

---

## 5. Feature — Board „Rechnungen“

### 5.1 Layout

Vier **horizontal scrollbare** Pipeline-Spalten (Claims-orientiert). Jede **Karte** = eine Rechnung. Am Spaltenkopf **kurzer Tooltip** zur Phase (shadcn `Tooltip`, Icon neben dem Titel).

| Spalte (UI) | Beschreibung | Ziel-Seed (Orientierung) |
|--------|----------------|---------------------------|
| Zur Prüfung (`pre_visit`) | `proposed` und `approved`: noch vor Einreichung beim Kostenträger | ~13 |
| Eingereicht (`submitted`) | `sent`: übermittelt, Antwort ausstehend | ~20 |
| Klärung (`followup`) | `denied`, `appealed`: Klärung erforderlich; Karten-Badge unterscheidet Ablehnung vs. Anfechtung | ~6 |
| Endzustand (`paid`) | `paid`: Zahlung eingegangen / abgeschlossen (Seed; erweiterbar um endgültig abgeschriebene Fälle) | ~9 |

### 5.2 Karteninhalt (kompakt, ~3 Zeilen)

1. Patientenname + Datum  
2. Betrag (€) + Kostenträger-Chip (**GKV** / **PKV** / **Selbstzahler**)  
3. Top-Code-Kurzlabel (z. B. „GOÄ 1 + ICD R51“) + **Konfidenz-Anzeige** (grün/gelb/rot) gemäß Testfall (nicht berechnet durch ein Modell)

### 5.3 Interaktionen (ohne DnD)

- **Klick** auf Karte → **Slide-Over** rechts: **Verlauf** (chronologische Ereignisse), Ziffernlisten (GOÄ + EBM nach Spec-Abschnitt), Aktionen (je nach Status). Rechnungsstatus wird auf Deutsch angezeigt (`SANDBOX_INVOICE_STATUS_LABEL`); interne Schlüssel (`proposed`, `approved`, …) bleiben Englisch.
- Statuswechsel nur über **UI-Aktionen**, z. B.:
  - „Freigeben“ nach Review,
  - „Rechnung versenden“ aus Freigegeben (Modal mit Versandweg),
  - Übergänge in Endzustände mit **Modal** („Bezahlt“ vs. „Abgelehnt“) wo sinnvoll.
- **Zurücksetzen / unkonventionelle Übergänge** (z. B. von „Eingereicht“ zurück): **Bestätigungsdialog** mit Hinweis, dass keine echte Übermittlung erfolgt.

### 5.4 Suche

Freitextfeld in derselben Zeile wie die Überschrift **„Übersicht“**, rechts ausgerichtet — filtert Karten nach Name, Kurzcode-Zusammenfassung oder Rechnungs-ID im **in-memory** Datenbestand.

---

## 6. Feature — Dokumentation anlegen

### 6.1 Einstieg

„Neue Dokumentation“ (Header-Button) → Route `/sandbox/abrechnung/neu`.

### 6.2 Formularstruktur (Tabs oder Stepper)

**Tab 1 — Patient**

- Felder: Name, Geburtsdatum, Versichertennummer, Kostenträger (GKV-Liste + PKV + Selbstzahler), Versicherungsstatus.
- Autocomplete aus Mock-Patientenpool oder neu anlegen.
- **„Testdaten generieren“:** wählt einen Eintrag aus den **Vorlagen** bzw. ordnet einen der **50 Cases** zu und füllt Felder plausibel.

**Tab 2 — Behandlung**

- Datum (Default: heute), Behandlungsperson (Dropdown aus Seed), Behandlungsart (Erstkontakt / Folge / Notfall / Vorsorge).
- Anamnese, Befund, Diagnose (Freitext), Therapie / Leistungen (Freitext).

**Tab 3 — Vorschau & Speichern**

- Formatierte Gesamtvorschau der Doku.
- Aktionen:
  - **„Speichern als Entwurf“** → Dokus-Liste, Status `draft`.
  - **„Speichern & Rechnung vorschlagen“** (primär) → startet Flow Abschnitt 7.

### 6.3 Validierung

Pflicht: Patient (Mindestangaben), Datum, **mindestens Anamnese oder Befund**. Inline-Fehler; Submit nur bei Mindestumfang.

---

## 7. Feature — Vorschlag → Review → Versand

### 7.1 Trigger

- Aus „Speichern & Rechnung vorschlagen“, oder
- Aus Dokus-Tabelle: „Rechnung erstellen“.

### 7.2 Schritt 1 — Kurze Verzögerung (~1,5 s)

Ladezustand („Analyse läuft …“ / neutraler Hinweis). Danach: **Lookup** der zum Kontext passenden **Case-ID** (Zuordnungsregel in Implementierung dokumentieren, z. B. Hash über Diagnose + Kostenträger + Template-ID oder explizite Auswahl in Debug-Panel nur für Entwicklung).

### 7.3 Schritt 2 — Review (Split-Screen)

**Links (~50 %)** — Doku **read-only**. Wo im Testfall **Highlight-Zuordnungen** definiert sind (Substring oder strukturierte Marker), werden diese Stellen hervorgehoben und mit den referenzierten Codes verknüpft (kein NLP).

**Rechts (~50 %)** — Vorschlagsrechnung:

- Kopf: Patient, Kostenträger, Versicherung.
- **ICD-10:** Code, Klartext, Konfidenz-Badge (Hoch/Mittel/Niedrig — **aus Testfall**), einzeilige Begründung, Aktionen Bearbeiten/Entfernen.
- **Leistungen — zwei Blöcke:**
  - **EBM** (Ziffer/Bezeichnung/Orientierung am Snapshot),
  - **GOÄ** (Ziffer, Bezeichnung, Faktor, Betrag €).
- „Hinzufügen“ öffnet **Picker** über einen **eingebetteten GOÄ-/EBM-Katalogausschnitt** (`src/data/sandbox/*.json`).
- **Summe** unten rechts, prominent.

**Footer:** Ablehnen (zurück auf Entwurf / kein aktiver Vorschlag), Freigeben (primär) → Status **Freigegeben**, Karte in Spalte 2. Änderungen können **auto-gespeichert** werden (lokal), ohne separaten „Anpassen“-Button.

### 7.4 Schritt 3 — Versand (Demo, ohne echte Übermittlung)

**Einstieg:** Rechnung hat internen Status `approved` (Anzeige: **Freigegeben**). Aktion **„Rechnung versenden“** öffnet das Modal `SendInvoiceDialog`.

**Modal-Inhalt (alles Deutsch):**

- Titel: „Rechnung versenden“, Beschreibung: es findet **keine** echte KV-/E-Mail-/Post-Übermittlung statt; es wird nur ein prototypischer Versandweg persistiert.
- Anzeige der Rechnungssumme (EUR, `de-DE`).
- **Radio-Gruppe — gespeicherter Versandweg** (`sent_via`, lesbar auch im Slide-Over unter Status):

  | Wert (intern) | Anzeige / Speicherstring |
  |---------------|---------------------------|
  | `kv` | KV-Abrechnung |
  | `pkv` | PKV per Brief |
  | `email` | Versand als E-Mail |

**Aktion „Als versendet markieren“** (`send`):

1. `patchInvoice` setzt `status: "sent"`.
2. `sent_via` = gewähltes Label aus der Tabelle (exakt der deutsche String, nicht der Radio-Key).
3. **Verlauf** (`timeline`): neuer Eintrag mit `ts` = ISO-Now, `event` = `Versendet — <Label>`, `actor` = `Nutzer`.
4. Toast: „Rechnung als versendet markiert.“
5. Modal schließt; optional schließt das übergeordnete Slide-Over.

**Board:** `invoiceBoardColumn` mappt `sent` → Spalte **Eingereicht** (`submitted`).

**Rückgängig:** Aus `sent` kann **„Zurück zur Freigabe…“** den Status auf `approved` setzen (Bestätigungsdialog); ein Verlaufs-Eintrag „Zurück zu Freigegeben“ wird angehängt. `sent_via` wird durch den Patch nicht explizit geleert (Implementierungsdetail; UI zeigt Versandweg nur bei `sent`).

**Seed-Daten:** Vorgebaute Rechnungen mit Status `sent` erhalten synthetische Verlaufseinträge „Versendet“ ohne gewählten Modal-Weg (`sent_via` fehlt oft); das ist für Demo-Menge akzeptabel.

---

## 8. Statusmaschine (Prototyp)

Vereinfachte Zustände für Prototyp und Seed:

```
draft → proposed → approved → sent → paid
           ↘ rejected     ↘ denied → appealed → paid | denied
```

Mapping auf Board-Spalten (`invoiceBoardColumn`):

| Board-Spalte (UI) | `InvoiceStatus` |
|-------------------|-----------------|
| Zur Prüfung | `proposed`, `approved` |
| Eingereicht | `sent` |
| Klärung | `denied`, `appealed` |
| Endzustand | `paid` |

**Deutsche Status-Labels in der UI** (`SANDBOX_INVOICE_STATUS_LABEL`): `proposed` → Vorschlag, `approved` → Freigegeben, `sent` → Versendet, `paid` → Bezahlt, `denied` → Abgelehnt, `appealed` → Anfechtung.

---

## 9. Datenmodell (In-Memory + Persistenz)

Alle Entitäten nur für die Sandbox; Typnamen orientieren sich an TypeScript.

### 9.1 `SandboxPatient`

```text
id, name, dob, insurance_type: 'GKV'|'PKV'|'self',
insurance_number, insurance_provider
```

### 9.2 `SandboxDocumentation`

```text
id, patient_id, date, provider_id, encounter_type,
anamnesis, findings, diagnosis_text, therapy,
status: 'draft'|'proposed'|'invoiced',
case_id?: string   // Verweis auf einen der 50 Basis-Cases, wenn zutreffend
created_at
```

### 9.3 `SandboxInvoice`

```text
id, documentation_id, patient_id,
diagnosis_codes: [{ code, label, confidence, rationale, source_snippet? }],
service_items_ebm: [{ code, label, amount_eur?, points? }],
service_items_goae: [{ code, label, factor, amount }],
total_amount,
status: 'proposed'|'approved'|'sent'|'paid'|'denied'|'appealed',
sent_via?, timeline: [{ ts, event, actor }]
```

Konfidenz und Rationale stammen **nur** aus den Testfällen.

### 9.4 `SandboxBillingCase` (authoritative Testfall)

Ein Eintrag aus den **50 synthetischen Fällen** — zentrale Datei für Generator und „Vorschlag“:

```text
id
difficulty: 'easy'|'medium'|'hard'
patient_profile_id?    // optional Verweis auf Seed-Patient
documentation: { ... } // strukturierte Default-Doku
highlights?: [{ field: 'anamnesis'|'findings'|..., start, end, icd_or_service_ref }]
diagnosis_codes: [...]
service_items_ebm: [...]
service_items_goae: [...]
total_amount
meta?: { notes?: string }
```

**Schwierigkeitsgrade:**

- **easy:** wenige Codes, eindeutige Texte.
- **medium:** mehrere ICD/Positionen, Varianten bei Faktoren oder Kombinationen.
- **hard:** knappe oder mehrdeutige Formulierungen, absichtliche Review-Hooks („Prüfen“), bewusste Diskrepanz zwischen EBM- und GOÄ-Narrativ **nur als illustrativer Beispielinhalt**, nicht als engine-validierte Aussage.

### 9.5 Persistenz

- **LocalStorage** (oder sessionStorage-Variante): kompletter Sandbox-State serialisiert.
- **Reset:** Button „Zurücksetzen“ im Sandbox-Header lädt den Seed neu (`buildSandboxSeed()`); LocalStorage-Eintrag wird überschrieben.
- Optional: Import/Export der Sandbox-State-JSON für Debugging (nicht Pflicht v0.2).

---

## 10. Dateien und Build-Hinweise

Vorgeschlagenes Layout (an Repo anpassen):

| Pfad | Inhalt |
|------|--------|
| `src/lib/sandbox/seed.ts` | Erzeugt den Initial-State (Praxis, Behandlungsperson(en), Patienten, Dokus, Rechnungen) gemäß Zielgrößen |
| `src/lib/sandbox/billingCases.ts` | **50** deterministische `SandboxBillingCase`-Einträge (programmatisch aus Templates) |
| `src/data/sandbox/goae-mock.json` · `ebm-mock.json` | Katalogausschnitte (angelehnt an GOÄ-/EBM-Snapshots) für Picker und Orientierungsbeträge |
| `scripts/validate-sandbox-catalogs.ts` (optional) | Prüft: alle in Testfällen genannten GOÄ-/EBM-Codes existieren in den Referenz-Snapshots |

---

## 11. Tech-Stack (Sandbox)

- Bestehendes App-Setup des Repos (**Vite + React** oder Next — wie Hauptapp).
- **Tailwind** + **shadcn/ui** für Tabellen, Dialoge, Sheet/Slide-Over, Formularfelder.
- State: **Zustand** oder React Context — kein Redux-Zwang.
- **Kein** `@dnd-kit` für dieses Board (bewusst nicht eingesetzt).

---

## 12. Seed-Zielgrößen (Orientierung)

Nach Reset soll der Nutzer ungefähr vorfinden:

| Entity | Richtwert |
|--------|-----------|
| Praxis / Behandlungsperson | 1 / 1 („Dr. M. Müller“) |
| Stammdaten / Patienten | ~30 — **40 % GKV / 50 % PKV / 10 % Selbstzahler** (Zyklus siehe `seed.ts` → `insuranceForIndex`) |
| Dokumentationen | ~50 über ~90 Tage, ~10 noch `draft` |
| Rechnungen gesamt | ~48 — verteilt auf die vier Spalten wie in Abschnitt 5.1 |
| Authoritative Billing-Cases | **50** (davon Nutzung für Generator + deterministischer Vorschlag) |

Rechnungsbeträge realistisch im Bereich ca. **€15–€350** pro Fall (fallabhängig).

---

## 13. Erfolgskriterium (ohne separate Anleitung)

In **unter drei Minuten:** Neue Doku über Testdatengenerator → Rechnung vorschlagen → eine ICD-Zeile entfernen, eine Ziffer ergänzen → freigeben → versenden → dieselbe Rechnung in der Spalte **„Eingereicht“** wiederfinden.

---

## 14. Offene Implementierungsdetails (keine Blocker)

- Exakte Route-Präfixe (`/sandbox/...`) und ob Sandbox **ohne** Produktiv-Auth erreichbar ist — separates Routing-Thema; in Spec nur als „Sandbox-Routes“ geführt.
- Ob ein kleines **Dev-only** Case-Picker-Overlay zum Debuggen erlaubt ist.
- Feinjustierung der Spalten-Summen bei Teilbearbeitung nach Edit im Review.

---

**Version:** 0.2 (Spec-Stand: Mai 2026)  
**Status:** Arbeitsgrundlage für Implementierung  
