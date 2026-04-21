# DocBill Spec – 03 UI/UX-Konzepte

> Teil der modularen Spezifikation v1.3. Siehe `00_INDEX.md` für Gesamtübersicht.
> Cross-Referenzen: → `02_MODES_AND_PIPELINE.md` (Datenstrukturen, Kennzeichnung), → `04_INVOICE_AND_EXPORT.md` (Export)

---

---

## 5. UI/UX-Konzepte

### 5.1 Batch-UI: 100+ Rechnungen verarbeiten

**Upload-Phase:**

Der Nutzer kann mehrere PDFs gleichzeitig hochladen (Drag & Drop, bis zu 500 Dateien) oder eine große PAD-Datei importieren, die mehrere Patienten/Rechnungen enthält. Das System erkennt automatisch die einzelnen Rechnungen innerhalb einer PAD-Datei.

**Batch-Identifikation:**

Jeder Batch erhält eine ID und einen vom Nutzer vergebenen Namen:

```typescript
interface Batch {
  id: string;                   // Auto-generiert (UUID)
  name: string;                 // Vom Nutzer vergeben, z.B. "Quartalsabrechnung Q1/2026"
  organisationId: string;
  erstelltVon: string;          // userId
  erstelltAm: string;
  aktualisiertAm: string;
  rechnungenCount: number;
  status: 'processing' | 'complete' | 'partial';
  zusammenfassung: {
    gesamtbetrag: number;       // Euro
    mitHinweisen: number;
    mitFehlern: number;
    optimierungspotenzial: number; // Euro
  };
}
```

**Speicherung:** Batches werden in der regulären Datenbank gespeichert und sind über die normale Navigations-Historie erreichbar. Der Nutzer findet seine Batches unter:

```
/batches                       → Alle Batches (Listenansicht)
/batches/{batchId}             → Einzelner Batch mit allen Rechnungen
```

Batches bleiben dauerhaft gespeichert (keine automatische Löschung), sofern der Nutzer sie nicht manuell löscht. Sie können jederzeit wieder geöffnet, durchsucht und exportiert werden.

**Batch-Listenansicht (Hauptansicht):**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Praxis Name – Quartalsabrechnung Q1/2026              [Alle annehmen ▾]   │
│  ──────────────────────────────────────────────────────────────────     │
│  142 Rechnungen │ 98 geprüft │ 31 mit Hinweisen │ 13 offen            │
│  Gesamtbetrag: €187.420  │  Optimierungspotenzial: +€4.230            │
│                                                                         │
│  Filter: [Alle ▾] [Mit Hinweisen ▾] [Status ▾]     Suche: [________]  │
│                                                                         │
│  ┌──┬─────────┬──────────┬──────────────────┬───────────┬────────────┐ │
│  │☐ │ Pat-ID  │ Betrag   │ Status           │ Hinweise  │ Aktion     │ │
│  ├──┼─────────┼──────────┼──────────────────┼───────────┼────────────┤ │
│  │☐ │ P-0421  │ €847,00  │ ✓ Geprüft        │ 2 Optim.  │ [Details]  │ │
│  │☐ │ P-0422  │ €1.240,50│ ⚠ 3 Hinweise     │ 1 Risiko  │ [Details]  │ │
│  │☐ │ P-0423  │ €392,00  │ ✓ Geprüft        │ —         │ [Details]  │ │
│  │☑ │ P-0424  │ €2.105,80│ ⚠ 1 Fehler       │ 1 Fehler  │ [Details]  │ │
│  └──┴─────────┴──────────┴──────────────────┴───────────┴────────────┘ │
│                                                                         │
│  Ausgewählt: 1  │  [Alle Vorschläge annehmen]  [Exportieren]           │
└─────────────────────────────────────────────────────────────────────────┘
```

**Detail-Ansicht: Side-Panel**

Beim Klick auf eine Rechnung in der Batch-Liste öffnet sich ein Side-Panel auf der rechten Seite. Die Listenansicht bleibt links sichtbar, sodass der Nutzer schnell zwischen Rechnungen navigieren kann.

```
┌─────────────────────────────────┬────────────────────────────────────────┐
│  Batch-Liste (links, schmal)    │  Detail-Panel (rechts, breit)          │
│                                 │                                        │
│  ☐ P-0421  €847    ✓           │  P-0422 │ Augenheilkunde │ €1.240,50   │
│  ☐ P-0422  €1.240  ⚠  ← aktiv │  ────────────────────────────────────  │
│  ☐ P-0423  €392    ✓           │                                        │
│  ☐ P-0424  €2.105  ⚠           │  Pos. 1: GOÄ 1240 │ 2,3x │ €61,66    │
│  ☐ P-0425  €523    ✓           │  ┌──────────────────────────────────┐  │
│  ...                            │  │ [Sicher]  Ziffer korrekt        │  │
│                                 │  │ Funduskopie bds., Indikation    │  │
│                                 │  │ dokumentiert.                    │  │
│                                 │  └──────────────────────────────────┘  │
│                                 │                                        │
│                                 │  Pos. 2: GOÄ 5855a │ 2,3x │ €61,66   │
│                                 │  ┌──────────────────────────────────┐  │
│                                 │  │ [Prüfen]  Analogbegründung      │  │
│                                 │  │ prüfenswert                      │  │
│                                 │  │                                  │  │
│                                 │  │ Hinweis: Die Begründung für die  │  │
│                                 │  │ Analogabrechnung sollte die      │  │
│                                 │  │ methodische Vergleichbarkeit     │  │
│                                 │  │ explizit benennen.               │  │
│                                 │  │                                  │  │
│                                 │  │ [Annehmen] [Anpassen] [Ablehnen] │  │
│                                 │  └──────────────────────────────────┘  │
│                                 │                                        │
│                                 │  Pos. 3: (fehlend)                     │
│                                 │  ┌──────────────────────────────────┐  │
│                                 │  │ [Pflicht fehlt]  GOP 03221      │  │
│                                 │  │ €18,40 – fehlt als Kombination  │  │
│                                 │  │                                  │  │
│                                 │  │ [Hinzufügen] [Ignorieren]        │  │
│                                 │  └──────────────────────────────────┘  │
│                                 │                                        │
│                                 │  ──────────────────────────────────    │
│                                 │  Gesamt: €1.240,50 → €1.258,90        │
│                                 │  (+€18,40 durch Kombinationspflicht)  │
│                                 │                                        │
│                                 │  [← Vorherige]  [Nächste →]           │
│                                 │  [Alle Vorschläge annehmen]            │
└─────────────────────────────────┴────────────────────────────────────────┘
```

Hinweise werden als Boxen innerhalb der jeweiligen Position/Ziffer dargestellt – nie losgelöst. Jeder Hinweis gehört visuell zum Kontext seiner Ziffer.

**Keyboard-Shortcuts:** `j/k` für Navigation in der Liste, `a` für Annehmen, `r` für Ablehnen, `Enter` für Details, `Escape` für Panel schließen.

**Bulk-Aktionen:**

Checkboxen in der Liste erlauben Mehrfachauswahl. "Alle Vorschläge annehmen" übernimmt alle Optimierungs- und Korrekturvorschläge für die ausgewählten Rechnungen auf einmal. Der Nutzer erhält eine Zusammenfassung: "42 Änderungen an 18 Rechnungen übernommen. Gesamtbetrag: +€2.340."

```typescript
interface BulkAktion {
  type: 'accept_all' | 'accept_selected' | 'export_all' | 'export_selected';
  batchId: string;
  rechnungIds: string[];
  optionen?: {
    exportFormat: 'pdf' | 'csv' | 'pad';
    includeBegruendungen: boolean;
    includeHinweise: boolean;
  };
}
```

### 5.2 Rechnungsvorschlag & Faktor-Anpassung

**Kontextgebundene Hinweise:**

Hinweise (Begründungspflicht, Dokumentationsanforderung, Risiko) werden als farbige Boxen direkt unterhalb der jeweiligen Ziffern-Zeile angezeigt. Sie sind nicht in einem separaten Bereich, sondern immer im Kontext der Ziffer, auf die sie sich beziehen.

**Faktor-Anpassung (GOÄ) – Slider-Komponente:**

```
┌─ GOÄ 1240 ─────────────────────────────────────────────┐
│  Aktueller Faktor: 2,3                                  │
│                                                          │
│  1,0 ──────────●────────────── 3,5                       │
│       [1,0] [1,8] [2,3] [2,5] [3,5]                     │
│                                                          │
│  Einfachsatz: €26,81  │  Aktuell: €61,66  │  3,5x: €93,84│
│                                                          │
│  ⚠ Ab Faktor 2,3: Begründung erforderlich (§5 Abs. 2)  │
│  ──────────────────────────────────────────────────────  │
│  Begründung (KI-generiert):                              │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Überdurchschnittlicher Zeitaufwand aufgrund       │    │
│  │ komplexer anatomischer Verhältnisse. Befund-      │    │
│  │ dokumentation mit 4 Einzelmessungen und           │    │
│  │ Verlaufsvergleich zu 3 Voruntersuchungen.         │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  [Neu generieren]  [Bearbeiten]                          │
│                                                          │
│  ℹ Essentiell für Begründungen:                          │
│    • Konkreten Mehraufwand benennen (Zeit, Komplexität)  │
│    • Patientenspezifische Besonderheiten nennen          │
│    • Quantifizierbare Angaben (Dauer, Anzahl Messungen)  │
└──────────────────────────────────────────────────────────┘
```

**Begründungsfeld – Logik:**

Das Begründungsfeld ist immer vorausgefüllt mit einer KI-generierten Begründung. Die KI versucht, die Begründung aus der vorhandenen Dokumentation abzuleiten.

```typescript
interface BegruendungsVorschlag {
  text: string;                    // KI-generierte Begründung
  quelle: 'dokumentation' | 'beispiel';
  // 'dokumentation' = aus hochgeladenem Dokument abgeleitet
  // 'beispiel' = generisches Copy-Paste-Beispiel
  hinweise: string[];              // Was ist essentiell?
  istAusDokumentationAbleitbar: boolean;
}
```

Wenn die Begründung **nicht** aus der vorliegenden Dokumentation ableitbar ist:
- Das System generiert ein generisches, Copy-Paste-fähiges Beispiel
- Es zeigt einen Hinweis: "Diese Begründung konnte nicht aus Ihrer Dokumentation abgeleitet werden. Bitte passen Sie den Text an Ihren konkreten Fall an."
- Die essentiellen Bestandteile einer guten Begründung werden aufgelistet

"Neu generieren" erstellt eine alternative Formulierung (anderer Fokus, andere Struktur).

### 5.3 Streaming & Ladezustände

LLM-Antworten werden per Streaming (SSE) in Echtzeit angezeigt:

| Phase | UI-Element |
|-------|-----------|
| Upload / Parsing | Fortschrittsbalken mit Dateiname |
| Pseudonymisierung | "Daten werden geschützt..." |
| LLM-Analyse | Streaming-Text, Kategorie für Kategorie |
| Post-Validierung | "Ergebnisse werden geprüft..." |
| Fertig | Vollständige Analyse mit allen Pills und Aktionen |

Bei Batch: Fortschrittsanzeige "Rechnung 47 von 142 wird geprüft..."
