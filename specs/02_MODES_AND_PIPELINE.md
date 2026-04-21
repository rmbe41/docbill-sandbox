# DocBill Spec – 02 Modi & Verarbeitungs-Pipeline

> Teil der modularen Spezifikation v1.3. Siehe `00_INDEX.md` für Gesamtübersicht.
> Cross-Referenzen: → `03_UI_UX.md` (UI-Details), → `05_KNOWLEDGE_BASE.md` (Wissensbasis), → `04_INVOICE_AND_EXPORT.md` (Rechnungserstellung)

---

## 3. Modi & Kernfunktionalität

DocBill bietet drei Modi:

| Modus | Name | Beschreibung |
|-------|------|-------------|
| A | Rechnungsprüfung | Bestehende Rechnung hochladen → Analyse + Optimierung |
| B | Fallbeschreibung | Leistung beschreiben → Ziffernvorschlag + Rechnungsentwurf |
| C | Fragestellung | GOÄ-/EBM-Frage stellen → strukturierte Antwort |

### 3.1 Regelwerk-Auswahl

Bei jedem Modus muss der Nutzer angeben wenn es das System nicht automatisch erkannt hat (das soll zuerst passieren), ob es sich um eine GOÄ- oder EBM-Abrechnung handelt. Das bestimmt, welches Regelwerk für die Analyse herangezogen wird.

```typescript
type Regelwerk = 'GOAE' | 'EBM';

interface AnalyseRequest {
  mode: 'A' | 'B' | 'C';
  regelwerk: Regelwerk;
  // ... weitere Felder
}
```

Bei PAD-Dateien kann das Regelwerk oft aus dem Format automatisch erkannt werden (GKV-Daten → EBM, PKV-Daten → GOÄ).

---

## 4. Verarbeitungs-Pipeline

### 4.1 Eingabeformate & Parsing

**Unterstützte Eingabeformate:**

| Format | Modus A | Modus B | Modus C |
|--------|---------|---------|---------|
| Freitext | Ja | Ja | Ja |
| PDF-Upload | Ja | Ja | Optional |
| Word-Upload (.docx) | Ja | Ja | Optional |
| Bild-Upload (JPG/PNG) | Ja | Ja | Nein |
| PAD-Datei | Ja | Nein | Nein |
| CSV/Excel | Ja | Nein | Nein |

**PAD-Datei-Parsing:**

PAD-Dateien sind Exportformate aus Praxis-Verwaltungs-Systemen (PVS). Die Formate variieren je nach Hersteller.

**Unterstützte PAD-Formate:**

| Format | PVS-Hersteller | Verbreitung | Priorität |
|--------|---------------|-------------|-----------|
| PAD_STANDARD | Diverse (offener Standard) | Hoch | P0 |
| TURBOMED | Turbomed (CompuGroup) | Hoch | P0 |
| CGM_M1 | CGM (M1 PRO) | Hoch | P0 |
| MEDISTAR | CompuGroup (Medistar) | Mittel | P1 |
| BDT | xDT-Familie (Behandlungsdaten) | Mittel | P1 |
| GDT | xDT-Familie (Gerätedaten) | Niedrig | P2 |
| x.isynet | medatixx (isynet) | Mittel | P1 |
| ALBIS | CompuGroup (ALBIS) | Mittel | P1 |
| QUINCY | Quincy (Falk) | Niedrig | P2 |

Anmerkung: Die xDT-Familie (BDT, GDT, ADT, KVDT) ist ein semi-standardisiertes Format der KBV. BDT (Behandlungsdatentransfer) ist besonders relevant für EBM-Abrechnungsdaten. Die Implementierung beginnt mit P0-Formaten und wird iterativ erweitert.

**Auto-Detection:**

```typescript
interface PADParser {
  supportedFormats: string[];
  parse(fileContent: Buffer, format?: string): ParsedInvoiceInput;
  detectFormat(fileContent: Buffer): string | null;
}
```

Wenn ein unbekanntes Format erkannt wird: "Dieses PAD-Format wird noch nicht unterstützt. Bitte exportieren Sie die Daten als PDF oder CSV."

**Datenstruktur nach Parsing:**

```typescript
interface ParsedInvoiceInput {
  mode: 'A' | 'B';
  regelwerk: 'GOAE' | 'EBM';
  inputType: 'freitext' | 'pdf' | 'word' | 'bild' | 'pad' | 'csv';
  rawText: string;
  patient: PseudonymizedPatient;
  positionen: ParsedLineItem[];
  metadata: {
    uploadTimestamp: string;
    fileSize?: number;
    ocrConfidence?: number;
    detectedPadFormat?: string;
  };
}

interface ParsedLineItem {
  ziffer: string;            // GOÄ-Ziffer oder EBM-GOP
  regelwerk: 'GOAE' | 'EBM';
  faktor?: number;           // Nur bei GOÄ (EBM hat keine Faktoren)
  anzahl: number;
  datum?: string;
  begruendung?: string;
  isAnalog: boolean;         // §6 Abs. 2 GOÄ
  analogReferenz?: string;
  punktzahl?: number;        // Bei EBM
  einzelbetrag: number;      // PFLICHT: Euro-Betrag pro Einheit
  gesamtbetrag: number;      // PFLICHT: Euro-Betrag gesamt (anzahl × einzelbetrag)
  validiert: boolean;
  validierungsFehler?: string;
}
```

**Gegenprüfung Datenstruktur ↔ JSON-Datenbasis:**

Nach dem Parsing wird jede `ParsedLineItem` gegen die entsprechende JSON-Datenbasis (GOÄ-JSON oder EBM-JSON) abgeglichen. Diese JSON-Dateien liegen lokal in der Anwendung (→ 7.1):

```typescript
interface ValidationResult {
  ziffer: string;
  existsInDatabase: boolean;
  zifferDetails?: ZifferDetail;
  faktorInRange?: boolean;         // GOÄ: Faktor im erlaubten Bereich?
  punktzahlMatch?: boolean;        // EBM: Punktzahl korrekt?
  fachgruppeErlaubt?: boolean;     // EBM: Fachgruppe darf diese GOP abrechnen?
  ausschluesse?: string[];
  pflichtKombinationen?: string[];
  berechneterBetrag: number;       // PFLICHT: System berechnet den korrekten Euro-Betrag
}
```

### 4.2 Pflicht-Analysestruktur (8 Kategorien)

Jede Eingabe (Modus A nach Parsing, Modus B nach Bestätigung) durchläuft obligatorisch alle acht Prüfkategorien in definierter Reihenfolge. Keine Kategorie darf fehlen oder übersprungen werden.

| # | Kategorie | Prüfinhalt |
|---|----------|-----------|
| 1 | Ziffernprüfung | Existiert die Ziffer? Ist sie für das Fachgebiet zulässig? Stimmt die Leistungsbeschreibung? |
| 2 | Faktorprüfung (GOÄ) / Punktzahlprüfung (EBM) | GOÄ: Faktor im Rahmen (1,0–3,5 bzw. §5a)? EBM: Punktzahl korrekt? Euro-Betrag korrekt berechnet? |
| 3 | Begründungspflicht | Ist eine Begründung erforderlich? Ist sie vorhanden und ausreichend? |
| 4 | Analogabrechnung | Liegt §6 Abs. 2 GOÄ korrekt vor? Ist die Analogziffer nachvollziehbar? |
| 5 | Ausschlüsse & Überschneidungen | Werden unzulässige Ziffernkombinationen verwendet? Doppelabrechnung? |
| 6 | Optimierungspotenzial | Welche zusätzlichen Ziffern könnten abgerechnet werden? Faktorsteigerung möglich? Inkl. Euro-Beträge. |
| 7 | Dokumentationsanforderungen | Welche Dokumentation ist für die Abrechnung erforderlich? |
| 8 | Kombinationspflicht | Welche Leistungen müssen in Kombination erbracht/abgerechnet werden, fehlen aber in der Auflistung? |

**Kategorie 8 – Kombinationspflicht (Details):**

```typescript
interface KombinationspflichtCheck {
  ziffer: string;
  pflichtKombinationen: {
    erforderlicheZiffer: string;
    grund: string;
    vorhanden: boolean;
    euroBetrag: number;          // PFLICHT: Was würde die fehlende Ziffer kosten?
  }[];
  fehlendePflichtZiffern: string[];
  hinweis: string;
}
```

**Ergebnis-Datenstruktur pro Kategorie:**

```typescript
interface KategorieErgebnis {
  kategorie: number;        // 1-8
  titel: string;
  status: 'ok' | 'warnung' | 'fehler' | 'optimierung';
  items: PruefItem[];
}

interface PruefItem {
  ziffer: string;
  regelwerk: 'GOAE' | 'EBM';
  kennzeichnung: Kennzeichnung;
  text: string;
  euroBetrag?: number;            // PFLICHT bei allen Vorschlägen
  quellen: Quellenreferenz[];
  aktion?: NutzerAktion;
}
```

### 4.3 Dual-Option bei Unsicherheit

Wenn das System bei einer Ziffer oder einem Faktor unsicher ist, werden zwei Optionen angeboten.

**Trigger:** Confidence-Score des LLM < 0.7 für eine bestimmte Zuordnung ODER wenn mehrere gleich plausible Ziffern in Frage kommen.

```typescript
interface DualOption {
  primaer: {
    ziffer: string;
    faktor?: number;
    euroBetrag: number;       // PFLICHT
    begruendung: string;
    confidence: number;
  };
  alternativ: {
    ziffer: string;
    faktor?: number;
    euroBetrag: number;       // PFLICHT
    begruendung: string;
    confidence: number;
  };
  erklaerung: string;
}
```

### 4.4 Post-Validierung

Jede vom LLM generierte Ziffer wird nach der Analyse gegen die lokale GOÄ-JSON- bzw. EBM-JSON-Datei validiert:

1. Existiert die Ziffer in der aktuellen JSON-Datenbasis?
2. Stimmen die vom LLM genannten Leistungsbeschreibungen mit den offiziellen überein?
3. Sind die genannten Punktzahlen/Faktoren innerhalb der erlaubten Grenzen? Sind notwendige Begründungen vorhanden? 
4. Sind die Ausschlussregeln korrekt referenziert?
5. Sind die berechneten Euro-Beträge korrekt?

Falls eine vom LLM generierte Ziffer nicht in der Datenbasis existiert → sie wird als "nicht validierbar" gekennzeichnet und dem Nutzer als unsicher markiert.

### 4.5 Kennzeichnungssystem

Jedes Analyseergebnis wird mit einem Kennzeichnungssystem (Stufen) versehen. Darstellung als **Pills** (farbige Label-Badges), keine Emojis.

**Stufen-Definition:**

| Stufe | Label | Farbe (Pill) | Bedeutung |
|-------|-------|-------------|-----------|
| SICHER | Sicher | Grün (#22C55E) | Rechtskonform, keine Aktion nötig |
| OPTIMIERUNG | Optimierung | Blau (#3B82F6) | Zusätzliches Erlöspotenzial möglich |
| PRÜFEN | Prüfen | Gelb (#EAB308) | Manuelle Überprüfung empfohlen |
| RISIKO | Risiko | Orange (#F97316) | Hohes Risiko einer PKV-Kürzung oder Beanstandung |
| FEHLER | Fehler | Rot (#EF4444) | Abrechnungsfehler, Korrektur erforderlich |
| UNVOLLSTÄNDIG | Unvollständig | Violett (#8B5CF6) | Kombinationspflicht nicht erfüllt |

**UI-Darstellung (Pill-Komponente):**

```tsx
<span className={`px-3 py-1 rounded-full text-sm font-medium ${pillColor}`}>
  {label}
</span>
```

Jede Pill ist klickbar und expandiert eine Erklärung mit Quelle.

### 4.5.1 Antwortbreite & Dokumentationsbeispiele

DocBill liefert nicht nur die korrekte Antwort, sondern zeigt dem Nutzer auch Alternativen und Dokumentationsbeispiele.

**Alternativvorschläge:**

Bei Modus B (Fallbeschreibung) und Kategorie 6 (Optimierungspotenzial) werden neben dem Hauptvorschlag bis zu 3 Alternativen angezeigt:

```typescript
interface AlternativVorschlag {
  ziffer: string;
  regelwerk: 'GOAE' | 'EBM';
  faktor?: number;
  euroBetrag: number;             // PFLICHT
  begruendung: string;
  vorteil: string;
  nachteil: string;
  dokumentationsAnforderung: string;
}
```

**Dokumentationsbeispiele:**

Für jede abgerechnete Leistung zeigt DocBill an, wie eine ausreichende Dokumentation aussehen könnte:

```typescript
interface DokumentationsBeispiel {
  ziffer: string;
  regelwerk: 'GOAE' | 'EBM';
  titel: string;
  mindestAnforderungen: string[];
  beispielText: string;
  beispielVarianten: {
    kontext: string;
    text: string;
  }[];
  tipps: string[];
}
```

### 4.6 Rechnungsvorschlag (Modus A/B)

Nach der Analyse generiert DocBill einen strukturierten Rechnungsvorschlag. Details zur UI bei Einzelrechnungen und Batch-Verarbeitung: → Abschnitt 5.

Alle Rechnungsvorschläge müssen Euro-Beträge enthalten – pro Position und als Gesamtsumme.

### 4.7 IGeL-Leistungen

Individuelle Gesundheitsleistungen (IGeL) sind Leistungen, die nicht im GKV-Leistungskatalog enthalten sind und vom Patienten selbst bezahlt werden. Sie werden nach GOÄ abgerechnet.

DocBill unterstützt IGeL durch: Kennzeichnung von Leistungen als IGeL-fähig, Hinweis auf Aufklärungspflicht und schriftliche Vereinbarung (§ 18 BMV-Ä), Prüfung der GOÄ-konformen Abrechnung, und Hinweis wenn eine Leistung sowohl GKV (EBM) als auch privat (GOÄ/IGeL) abrechnungsfähig wäre.

### 4.8 Feedback-System

Das Feedback-System hat zwei parallele Kanäle:

**Kanal 1: Allgemeines Feedback (Daumen hoch/runter)**

An jeder Antwort von DocBill gibt es Daumen-Buttons. Dieses Feedback bewertet die Gesamtqualität der Antwort.

```typescript
interface DaumenFeedback {
  responseId: string;
  type: 'up' | 'down';
  freitextKommentar?: string;
  timestamp: string;
  userId: string;
}
```

**Kanal 2: Vorschlags-Feedback (Annehmen/Ablehnen)**

Bei Modus B (Ziffernvorschläge) und bei Optimierungsvorschlägen (Kategorie 6) liefert die Annehmen/Ablehnen-Interaktion implizites Qualitätsfeedback.

```typescript
interface VorschlagFeedback {
  vorschlagId: string;
  responseId: string;
  ziffer: string;
  aktion: 'accepted' | 'rejected' | 'modified';
  modifiedTo?: {
    ziffer?: string;
    faktor?: number;
  };
  timestamp: string;
  userId: string;
  fachgebiet?: string;
}
```

**Feedback-Loop zur KI-Verbesserung:**

```
Annehmen/Ablehnen-Daten
        ↓
  Aggregation pro Ziffer + Fachgebiet
        ↓
  Wenn Ablehnungsrate > 30% für eine Ziffer in einem Fachgebiet:
        ↓
  → Flag für manuelles Review
  → Prompt-Anpassung priorisieren
        ↓
  Wenn Annahmerate > 90%:
        ↓
  → Confidence-Score für diese Empfehlung erhöhen
```

**Manueller Review-Prozess:**

Wenn das System ein "Flag für manuelles Review" setzt (Ablehnungsrate > 30%), wird ein Eintrag in der Admin-Queue erstellt. Der Review wird vom Admin der jeweiligen Organisation durchgeführt – oder, wenn es ein systemweites Muster ist, vom DocBill-internen Team. Die Admin-Queue ist über das Feedback-Dashboard erreichbar (→ unten).

Daten werden anonymisiert und ohne PII gespeichert. Kein direktes LLM-Fine-Tuning auf Nutzerdaten – stattdessen informieren die Daten Prompt-Iterationen und Few-Shot-Beispiele.

**Feedback-Dashboard:**

Das Dashboard ist über eine eigene Route erreichbar:

```
/dashboard/feedback
```

Zugänglich für: Admin-Nutzer (vollständig), Manager (eigene Organisations-Daten).

**Demo-Modus:** Für interne Tests und Demos gibt es einen speziellen Zugang:

```
/dashboard/feedback?demo=true
```

Im Demo-Modus werden synthetische Daten angezeigt (keine echten Nutzerdaten). Dieser Modus ist ohne Login erreichbar und kann für Kundenpräsentationen genutzt werden. In Production ist der Demo-Modus über ein Feature-Flag (PostHog) steuerbar.

**Dashboard-Metriken:**

| Metrik | Berechnung |
|--------|-----------|
| Annahmerate gesamt | accepted / (accepted + rejected + modified) |
| Annahmerate pro Fachgebiet | Gruppiert nach Nutzer-Fachgebiet |
| Häufigste Ablehnungsgründe | Clustering über Freitext-Kommentare |
| Daumen-Ratio | up / (up + down) |
| Trend (wöchentlich) | Veränderung der Raten über Zeit |
| Review-Queue | Offene Flags mit Ablehnungsrate > 30% |

### 4.9 Einwilligung bei Abrechnungen

Es gibt Fälle, in denen eine Patienteneinwilligung (z.B. für IGeL, Analogabrechnung) noch nicht vorliegt, der Arzt aber trotzdem die Abrechnung vorbereiten muss.

**Konzept: Inline-Hinweis statt Entwurfs-Modus**

Die Rechnung wird in DocBill vollständig verarbeitet und als "fertig" betrachtet. Der Nutzer muss nicht zurückkommen. Stattdessen zeigt DocBill einen klar sichtbaren Inline-Hinweis an den betreffenden Positionen:

```
┌─ Hinweis ────────────────────────────────────────────┐
│  ⚠ Rechnung nur gültig wenn Einwilligung vorhanden.  │
│                                                       │
│  Für folgende Positionen ist eine schriftliche        │
│  Patienteneinwilligung erforderlich:                  │
│  • Position 3: GOÄ 5855a (IGeL) – €61,66             │
│  • Position 5: GOÄ 1240 analog – €38,20              │
│                                                       │
│  Die Einholung der Einwilligung liegt in der          │
│  Verantwortung der Praxis.                            │
└───────────────────────────────────────────────────────┘
```

Die Rechnung kann sofort exportiert werden. Der Hinweis wird im Export (PDF) als sichtbarer Vermerk gedruckt. DocBill betrachtet die Rechnung als abgeschlossen – der Nutzer muss sich nur noch um die Einholung der Einwilligung kümmern.

```typescript
interface EinwilligungsHinweis {
  positionIndex: number;
  ziffer: string;
  euroBetrag: number;
  einwilligungTyp: 'igel' | 'analog' | 'datenschutz';
  hinweisText: string;     // "Rechnung nur gültig wenn Einwilligung vorhanden."
}
```
