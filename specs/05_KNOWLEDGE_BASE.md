# DocBill Spec – 05 Wissensbasis & Quellen

> Teil der modularen Spezifikation v1.3. Siehe `00_INDEX.md` für Gesamtübersicht.
> Cross-Referenzen: → `06_ARCHITECTURE.md` (Chunking, EBM-Integration), → `08_AUTH_AND_TENANCY.md` (Datenisolierung)

---


## 7. Wissensbasis & Quellen

### 7.1 Kern-Wissensbasis (lokal als JSON)

GOÄ (und Kommentare) und EBM liegen als strukturierte JSON-Dateien lokal in der Anwendung. Sie werden nicht über die Vector-DB / Chunking-Pipeline verarbeitet, sondern direkt aus den JSON-Dateien gelesen. Das ist schneller und liefert präzisere Ergebnisse als ein RAG-basierter Ansatz für strukturierte Referenzdaten.

| Quelle | Format | Speicherort | Update-Prozess |
|--------|--------|-------------|---------------|
| GOÄ-Gebührenverzeichnis | JSON | Lokal in der Anwendung | bestehende JSON-Datei |
| EBM-Gebührenverzeichnis | JSON | Lokal in der Anwendung | neue JSON-Datei |
| GOÄ-Paragraphen (§1–§12) | JSON | Lokal in der Anwendung | Teil der GOÄ-JSON |
| EBM Allgemeine Bestimmungen | JSON | Lokal in der Anwendung | Teil der EBM-JSON |

Hinweis: Die EBM-JSON muss noch erstellt werden (→ 8.7 EBM-Integration). Die GOÄ-JSON existiert bereits.

**KI-Kontext-Wissen:** Zusätzlich zu den JSON-Dateien gibt es Kontext-Wissen, das im Backend fest hinterlegt ist (z.B. Abrechnungsregeln, Schwellenfaktor-Logik, Kombinationsvorschriften). Dieses Wissen wird als Teil der System-Prompts an das LLM übergeben und nicht dynamisch aus einer Datenbank geladen.

### 7.2 BÄK-Beschlüsse & BA-Beschlüsse

**Beschaffungskonzept: Wöchentlicher automatischer Crawl**

BÄK-Beschlüsse und Bewertungsausschuss-Beschlüsse werden automatisch beschafft, nicht manuell hochgeladen:

```
Wöchentlicher Cron-Job (Sonntagnacht):
  1. Crawl der offiziellen Quellen:
     → https://www.bundesaerztekammer.de (GOÄ-Ratgeber, Beschlüsse)
     → https://www.kbv.de/html/ebm.php (EBM-Updates, BA-Beschlüsse)
  2. Neue Dokumente identifizieren (Diff zu letztem Crawl)
  3. PDF/HTML herunterladen und Text extrahieren
  4. Relevanzfilter ausführen (→ 7.3)
  5. Relevante Beschlüsse → Chunking → Vector-DB
  6. Report generieren → Admin-Benachrichtigung (E-Mail/Slack)
```

Der Admin erhält wöchentlich einen Report: "3 neue Beschlüsse gefunden, 2 als relevant eingestuft und importiert, 1 übersprungen."

Falls der Crawl fehlschlägt (Website-Änderung, Timeout), wird ein Alert an den Admin gesendet. Manuelle Nacharbeit ist in diesem Fall nötig.

### 7.3 Relevanzfilter für BÄK-/BA-Beschlüsse

Nicht jeder BÄK-Beschluss ist für DocBill relevant. Es braucht einen Filtermechanismus.

**Automatische Relevanzprüfung:**

Jeder neue Beschluss wird beim Import durch einen LLM-gestützten Relevanzfilter verarbeitet:

```typescript
interface BeschlussBewertung {
  beschlussId: string;
  titel: string;
  datum: string;
  quelle: 'BAEK' | 'KBV_BA';
  relevanz: {
    score: number;              // 0-1
    kategorie: 'direkt_relevant' | 'indirekt_relevant' | 'nicht_relevant';
    begruendung: string;
  };
  betroffeneZiffern: string[];
  betroffeneFachgebiete: string[];
  aktion: 'auto_import' | 'manual_review' | 'skip';
}
```

**Entscheidungslogik:**

```
Score ≥ 0.8 UND betroffene Ziffern erkannt → auto_import
Score 0.5–0.8 ODER nur Fachgebiet erkannt → manual_review (Admin-Queue)
Score < 0.5 → skip (mit Logging)
```

**Kriterien für "direkt relevant":**

1. Beschluss referenziert konkrete GOÄ-Ziffern oder EBM-GOPs
2. Beschluss ändert Abrechnungsregeln, Ausschlüsse oder Kombinationsvorschriften
3. Beschluss betrifft Analogabrechnungen
4. Beschluss enthält neue Bewertungen oder Punktzahlen

**Kriterien für "indirekt relevant":**

1. Beschlüsse zu nicht-ambulanten Bereichen (stationär) – diese können Auswirkungen auf ambulante Analogabrechnungen oder Zuweisungen haben und werden zur manuellen Prüfung vorgemerkt
2. Beschlüsse mit Bezug zu Fachgebieten, aber ohne konkrete Ziffern

**Kriterien für "nicht relevant":**

1. Organisatorische Beschlüsse (Sitzungstermine, Personalien)
2. Beschlüsse ohne jeden Bezug zu Abrechnungsziffern oder medizinischen Leistungen

### 7.4 Sekundärquellen (Kommentarliteratur)

Kommentarliteratur (Brück, Hoffmann, Lang/Schäfer) ist für die Abrechnungsqualität wertvoll, aber lizenzpflichtig.

**Konzept: Empfehlung zum Upload in den Einstellungen**

In den Einstellungen wird dem Nutzer empfohlen, lizenzierte Kommentarliteratur hochzuladen:

```
┌─ Einstellungen → Wissensbasis ──────────────────────────┐
│                                                          │
│  Empfohlene Quellen für bessere Analyseergebnisse:       │
│                                                          │
│  • Brück: GOÄ-Kommentar                                 │
│    [Datei hochladen]  Status: Nicht vorhanden            │
│                                                          │
│  • Hoffmann: GOÄ-Kommentar                               │
│    [Datei hochladen]  Status: Nicht vorhanden            │
│                                                          │
│  • Lang/Schäfer: GOÄ-Kommentar                           │
│    [Datei hochladen]  Status: Nicht vorhanden            │
│                                                          │
│  Hochgeladene Dateien werden für Ihre Organisation       │
│  verfügbar gemacht und über Chunking verarbeitet.        │
└──────────────────────────────────────────────────────────┘
```

Nutzer-Uploads werden nur für die jeweilige Organisation sichtbar (→ 13.4 Datenisolierung).

Sobald DocBill selbst eine lizenzierte Datei besitzt (z.B. durch Verlagsvereinbarung), wird diese global für alle Organisationen hinterlegt – der Nutzer muss dann nichts hochladen.

### 7.5 Quellenreferenz-Format

```typescript
interface Quellenreferenz {
  typ: 'goae_paragraph' | 'goae_ziffer' | 'ebm_gop' | 'ebm_bestimmung' | 'baek_beschluss' | 'ba_beschluss' | 'kommentar';
  referenz: string;
  kurztext: string;
  url?: string;
}
```
