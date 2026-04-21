# DocBill Spec – 06 Technische Architektur

> Teil der modularen Spezifikation v1.3. Siehe `00_INDEX.md` für Gesamtübersicht.
> Cross-Referenzen: → `05_KNOWLEDGE_BASE.md` (JSON-Dateien, BÄK-Crawl), → `02_MODES_AND_PIPELINE.md` (Datenstrukturen)

---

---

## 8. Technische Architektur

### 8.1 System-Architektur (Übersicht)

```
┌──────────────────────────────────────────────────────────┐
│                     FRONTEND (Next.js)                    │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌─────────┐ │
│  │ Modus A │  │ Modus B  │  │ Modus C   │  │ Batch   │ │
│  │ Prüfung │  │ Vorschlag│  │ Frage     │  │ Manager │ │
│  └────┬────┘  └────┬─────┘  └─────┬─────┘  └────┬────┘ │
│       └─────────────┴──────────────┴─────────────┘       │
│                         │ HTTPS/WSS                       │
└─────────────────────────┼────────────────────────────────┘
                          │
┌─────────────────────────┼────────────────────────────────┐
│                     API-GATEWAY                           │
│  Auth │ Rate-Limiting │ Input-Validation │ Routing        │
└─────────────────────────┼────────────────────────────────┘
                          │
┌─────────────────────────┼────────────────────────────────┐
│                   BACKEND-SERVICES                        │
│                                                           │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Parsing    │  │ Pseudonym.   │  │ LLM-Orchestrator │  │
│  │ Service    │  │ Pipeline     │  │ (Prompt + RAG)   │  │
│  └─────┬──────┘  └──────┬───────┘  └────────┬─────────┘  │
│        │               │                   │              │
│  ┌─────┴───────────────┴───────────────────┘              │
│  │                                                        │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  │ Post-       │  │ Feedback     │  │ Export       │  │
│  │  │ Validierung │  │ Service      │  │ Service      │  │
│  │  └─────────────┘  └──────────────┘  └──────────────┘  │
│  │                                                        │
│  │  ┌──────────────────┐                                  │
│  │  │ BÄK/BA Crawl     │  ← Wöchentlicher Cron-Job       │
│  │  │ Service           │                                  │
│  │  └──────────────────┘                                  │
│  └────────────────────────────────────────────────────────│
└──────────────┬───────────────┬───────────────┬───────────┘
               │               │               │
    ┌──────────┴──┐   ┌───────┴──────┐  ┌─────┴────────┐
    │ PostgreSQL  │   │ Vector-DB    │  │ Claude API   │
    │ (Daten,     │   │ (BÄK, BA,   │  │ (Anthropic)  │
    │  Feedback,  │   │  Nutzer-     │  │              │
    │  Batches,   │   │  Uploads)    │  │              │
    │  Sessions)  │   │              │  │              │
    └─────────────┘   └──────────────┘  └──────────────┘
    
    ┌─────────────┐   ┌──────────────┐
    │ GOÄ-JSON    │   │ EBM-JSON     │  ← Lokale Dateien
    │ (lokal)     │   │ (lokal)      │    im Backend
    └─────────────┘   └──────────────┘
```

### 8.2 Pseudonymisierungs-Pipeline

Vor jeder LLM-Verarbeitung werden personenbezogene Daten (PII) entfernt und durch Platzhalter ersetzt.

**PII-Erkennungsstrategie (zweistufig):**

```
Stufe 1: Regex-basiert (schnell, deterministisch)
  → Namen (Vor-/Nachname-Muster)
  → Geburtsdaten (DD.MM.YYYY, YYYY-MM-DD)
  → Versicherungsnummern (Muster je nach PKV/GKV)
  → Adressen (PLZ + Ort + Straße)
  → Telefonnummern, E-Mails

Stufe 2: NER-basiert (ML-Modell, z.B. spaCy de_core_news_lg)
  → Fängt Fälle, die Regex nicht erkennt
  → Personen-, Orts-, Organisationsnamen
```

**Mapping-Tabelle:**

```typescript
interface PseudonymMap {
  sessionId: string;
  mappings: {
    original: string;
    pseudonym: string;
    type: 'person' | 'date' | 'insurance_id' | 'address' | 'phone' | 'email';
  }[];
  expiresAt: string;          // Max 24h
}
```

Die Mapping-Tabelle wird im RAM gehalten (Redis) und nach max. 24h automatisch gelöscht. Kein Persistieren auf Disk.

### 8.3 Verarbeitung großer Dateien

```
Upload-Limits:
  Max. Dateigröße: 200 MB
  Max. PDF-Seiten: 500
  Max. Einzeldateien pro Batch: 500
  Max. PAD-Datei: 200 MB (ca. 10.000 Rechnungen)
```

**Processing-Pipeline für große Dateien:**

```
1. Upload → Chunk-Upload (Resumable, TUS-Protokoll)
   → Fortschrittsanzeige im Frontend
   
2. File-Analyse (ohne LLM):
   → PDF: Seitenzahl ermitteln, Text-Extraktion-Test (Seite 1)
   → PAD: Header lesen, Anzahl Records ermitteln
   → Speicherung in temporärem S3-Bucket (verschlüsselt, TTL: 24h)

3. Splitting:
   → PDF > 20 Seiten: Aufteilen in logische Einheiten (Rechnungsgrenzen erkennen)
   → PAD: Aufteilen in einzelne Patientenfälle (Record-Grenzen)

4. Queue-basierte Verarbeitung:
   → Jede Einheit wird als Job in eine Message-Queue (Bull/BullMQ) gelegt
   → Worker-Prozesse verarbeiten Jobs parallel (max. 5 gleichzeitig pro Nutzer)
   → Frontend zeigt Fortschritt via WebSocket

5. Ergebnis-Aggregation:
   → Alle Einzelergebnisse werden in der Batch-Ansicht zusammengeführt
```

**Timeout-Strategie:**

| Dateigröße | Max. Verarbeitungszeit | Nutzer-Feedback |
|-----------|----------------------|-----------------|
| < 5 MB | 60s | Inline-Streaming |
| 5–50 MB | 5 min | Fortschrittsbalken |
| 50–200 MB | 30 min | "Verarbeitung läuft im Hintergrund. Sie erhalten eine Benachrichtigung." |

### 8.4 Chunking & Vector-DB

**Wichtige Unterscheidung:**

GOÄ und EBM werden **nicht** über die Chunking-/Vector-DB-Pipeline verarbeitet. Sie liegen als lokale JSON-Dateien vor und werden direkt abgefragt (→ 7.1). Das ist schneller und bei strukturierten Referenzdaten qualitativ besser.

Die Chunking-Pipeline wird nur für folgende Quellen verwendet:

1. **BÄK-Beschlüsse** (automatisch via Crawl → 7.2)
2. **BA-Beschlüsse** (automatisch via Crawl → 7.2)
3. **Nutzer-Uploads** (Kommentarliteratur, eigene Dokumente via Einstellungen → 7.4)

**Chunking-Strategie für diese Quellen:**

**Stufe 1: Strukturelles Chunking**

```
BÄK-Beschluss → 1 Chunk pro Beschluss (ggf. Split bei > 2000 Token)
BA-Beschluss → 1 Chunk pro Beschluss
Kommentarliteratur → 1 Chunk pro Ziffer/Abschnitt (entlang der Dokumentstruktur)
```

**Stufe 2: Kontextanreicherung**

```typescript
interface EnrichedChunk {
  id: string;
  content: string;
  metadata: {
    source: 'BAEK' | 'KBV_BA' | 'USER_UPLOAD';
    organisationId?: string;    // null = global, sonst org-spezifisch
    documentId: string;
    ziffer?: string;
    fachgebiete?: string[];
    version: string;
    gueltigAb?: string;
    gueltigBis?: string;
    schlagworte: string[];
  };
  relatedChunkIds?: string[];
}
```

**Stufe 3: Cross-Referenz-Graphen**

Ziffern referenzieren andere Ziffern (Ausschlüsse, Kombinationen, Zuschläge). Diese Beziehungen werden primär aus den JSON-Dateien gelesen, aber bei BÄK-/BA-Beschlüssen werden zusätzliche Referenzen erkannt und als Chunk-Relationen modelliert.

**Update-Prozess über Einstellungen (nur für Nutzer-Uploads):**

Admin-Nutzer können über die Einstellungen neue Dokumente hochladen. Das System:

1. Erkennt den Dokumenttyp
2. Führt die Chunking-Pipeline aus
3. Aktualisiert die Vector-DB
4. Loggt die Änderung (Audit-Trail)

### 8.5 Error-Handling

| Fehlerszenario | Nutzer-Feedback | System-Aktion |
|---------------|----------------|---------------|
| Leere PDF | "Das Dokument enthält keinen erkennbaren Text." | Abbruch, kein LLM-Call |
| Ungültige GOÄ-/EBM-Ziffer | "Ziffer [X] nicht gefunden. Meinten Sie [Y]?" | Fuzzy-Match, Vorschlag |
| LLM-Timeout (> 120s) | "Die Analyse dauert länger als erwartet. Wir versuchen es erneut." | Retry (3×), dann Fallback |
| LLM nicht erreichbar | "Der Dienst ist vorübergehend nicht verfügbar." | Fallback-Modus (nur Validierung ohne KI) |
| Upload > 200MB | "Die Datei ist zu groß. Maximum: 200 MB." | Abbruch vor Upload |
| Dokument nicht Deutsch | "DocBill unterstützt derzeit nur deutschsprachige Dokumente." | Spracherkennung in Pipeline |
| PAD-Format unbekannt | "Dieses Format wird nicht unterstützt. Bitte als PDF oder CSV exportieren." | Logging des Formats |
| Faktor > 3,5 (GOÄ) | "Der Höchstsatz beträgt 3,5 (§5 Abs. 3 GOÄ). Ausnahmen: §5a." | Hard-Block |
| OCR-Qualität < 60% | "Die Bildqualität ist zu niedrig für eine zuverlässige Analyse." | Confidence-Score anzeigen |
| Netzwerkabbruch | "Verbindung unterbrochen. Die Analyse wird fortgesetzt." | Retry-Logik (3×), idempotente Request-IDs |
| GOÄ-/EBM-JSON korrupt | Admin-Alert | Healthcheck beim Start |

### 8.6 Session-Modell

```typescript
interface Session {
  id: string;
  userId: string;
  organisationId: string;
  mode: 'A' | 'B' | 'C' | 'BATCH';
  regelwerk: 'GOAE' | 'EBM';
  batchId?: string;
  messages: Message[];
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;           // +24h nach letzter Aktivität
  pseudonymMap?: PseudonymMap;
}
```

### 8.7 EBM-Integration

Der EBM (Einheitlicher Bewertungsmaßstab) wird als lokale JSON-Datei neben der GOÄ-JSON integriert. Die EBM-PDF (z.B. "2026-2-ebm.pdf" für Q2/2026) wird einmalig in eine strukturierte JSON-Datei überführt und dann lokal in der Anwendung abgelegt.

**EBM-JSON-Struktur:**

```typescript
interface EBMDatenbank {
  version: string;             // z.B. "2026-Q2"
  gueltigAb: string;
  orientierungswert: number;   // Cent pro Punkt (2026: 12,7404)
  
  allgemeineBestimmungen: EBMBestimmung[];
  kapitel: EBMKapitel[];
  gops: EBMGebuerenordnungsposition[];
}

interface EBMGebuerenordnungsposition {
  gop: string;
  bezeichnung: string;
  kapitel: string;
  punktzahl: number;
  euroWert: number;            // punktzahl × orientierungswert
  
  obligateLeistungsinhalte: string[];
  fakultativeLeistungsinhalte: string[];
  
  abrechnungsbestimmungen: {
    frequenz?: string;
    alter?: string;
    arztgruppen: string[];
    ausschluss: string[];
    pflichtKombination: string[];
  };
  
  anmerkungen: string[];
  zuschlaege?: {
    gop: string;
    bedingung: string;
  }[];
}

interface EBMKapitel {
  nummer: string;
  bezeichnung: string;
  versorgungsbereich: 'hausaerztlich' | 'fachaerztlich' | 'uebergreifend';
  praeambel: string;
  gops: string[];
}

interface EBMBestimmung {
  nummer: string;
  titel: string;
  inhalt: string;
  betroffeneGops?: string[];
}
```

**Initiale Erstellung der EBM-JSON:**

Die EBM-PDF wird einmalig manuell/semi-automatisch in JSON konvertiert:

```
1. EBM-PDF (z.B. 2026-2-ebm.pdf) als Grundlage
2. Text-Extraktion (pdftotext mit Layout-Erhaltung)
3. Strukturerkennung + manuelle Nachbearbeitung:
   → Kapitel-Header, GOP-Blöcke, Punktzahlen, Leistungsinhalte
4. JSON-Generierung
5. Manuelle Validierung: Stichprobe von 50+ GOPs
6. JSON-Datei wird als Teil der Anwendung deployed
```

Für quartalsweise Updates wird die gleiche Pipeline erneut ausgeführt und die neue JSON-Datei per Admin-Upload eingespielt.

**EBM-spezifische Prüflogik:**

| Prüfung | Beschreibung |
|---------|-------------|
| Fachgruppenprüfung | Darf diese Arztgruppe die GOP abrechnen? |
| Frequenzprüfung | Wird die Abrechnungshäufigkeit eingehalten? |
| Altersprüfung | Erfüllt der Patient die Altersvoraussetzung? |
| Quartalsprüfung | Behandlungsfall-Logik innerhalb eines Quartals |
| Ausschlüsse | Welche GOPs dürfen nicht nebeneinander stehen? |
| Budgetrelevanz | Ist die GOP budgetrelevant oder extrabudgetär? |

