# DocBill Spec – 04 Rechnungserstellung & Export

> Teil der modularen Spezifikation v1.3. Siehe `00_INDEX.md` für Gesamtübersicht.
> Cross-Referenzen: → `02_MODES_AND_PIPELINE.md` (Kennzeichnung, Analyse), → `03_UI_UX.md` (Batch-UI)

---

---

## 6. Rechnungserstellung

Nach Analyse und Nutzerbestätigung kann DocBill einen Rechnungsentwurf generieren.

**Rechnungsentwurf-Datenstruktur:**

```typescript
interface Rechnungsentwurf {
  id: string;
  batchId?: string;              // Falls Teil eines Batches
  patient: PseudonymizedPatient;
  regelwerk: 'GOAE' | 'EBM';
  positionen: RechnungsPosition[];
  gesamtbetrag: number;          // PFLICHT: Euro-Gesamtbetrag
  status: 'fertig' | 'exportiert';
  erstelltAm: string;
  hinweise: RechnungsHinweis[];
  einwilligungsHinweise: EinwilligungsHinweis[];
}

interface RechnungsPosition {
  ziffer: string;
  beschreibung: string;
  faktor?: number;         // Nur GOÄ
  punktzahl?: number;       // Nur EBM
  anzahl: number;
  einzelbetrag: number;     // PFLICHT: Euro
  gesamtbetrag: number;     // PFLICHT: Euro
  begruendung?: string;     // KI-vorausgefüllt bei Begründungspflicht
  isAnalog: boolean;
  kennzeichnung: Kennzeichnung;
}

interface RechnungsHinweis {
  positionIndex: number;
  typ: 'info' | 'warnung' | 'pflicht';
  text: string;
}
```

**Export-Formate:**

| Format | Verwendung |
|--------|-----------|
| PDF | Zum Versand an Patient/PKV |
| CSV | Import in PVS-Systeme |
| PAD | Re-Import in unterstützte PVS-Systeme |

