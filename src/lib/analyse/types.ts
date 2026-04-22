/**
 * Analyse-Vertrag — specs/02_MODES_AND_PIPELINE.md (Auszug).
 */

export type Regelwerk = "GOAE" | "EBM";

export type AnalyseModus = "A" | "B" | "C";

export interface AnalyseRequest {
  mode: AnalyseModus;
  regelwerk: Regelwerk;
}

export type ParsedInputType = "freitext" | "pdf" | "word" | "bild" | "pad" | "csv";

export interface ParsedLineItem {
  ziffer: string;
  regelwerk: Regelwerk;
  faktor?: number;
  anzahl: number;
  datum?: string;
  begruendung?: string;
  isAnalog: boolean;
  analogReferenz?: string;
  punktzahl?: number;
  einzelbetrag: number;
  gesamtbetrag: number;
  validiert: boolean;
  validierungsFehler?: string;
}

export interface ParsedInvoiceInput {
  mode: "A" | "B";
  regelwerk: Regelwerk;
  inputType: ParsedInputType;
  rawText: string;
  patient: { pseudonymId: string; geburtsjahr?: number };
  positionen: ParsedLineItem[];
  metadata: {
    uploadTimestamp: string;
    fileSize?: number;
    ocrConfidence?: number;
    detectedPadFormat?: string;
  };
}

export interface ValidationResult {
  ziffer: string;
  existsInDatabase: boolean;
  zifferDetails?: unknown;
  faktorInRange?: boolean;
  punktzahlMatch?: boolean;
  fachgruppeErlaubt?: boolean;
  ausschluesse?: string[];
  pflichtKombinationen?: string[];
  berechneterBetrag: number;
}

/**
 * Pills / Analyse: Stufen gemäß 02 §4.5. In Spec 04 heißt derselbe Wertetyp
 * `Kennzeichnung` an der Rechnungsposition – Alias: `@/lib/rechnung/rechnungsentwurfTypes` → `Kennzeichnung`.
 */
export type KennzeichnungStufe =
  | "SICHER"
  | "OPTIMIERUNG"
  | "PRÜFEN"
  | "RISIKO"
  | "FEHLER"
  | "UNVOLLSTÄNDIG";

export type KategorieStatus = "ok" | "warnung" | "fehler" | "optimierung";

export type Quellenreferenz = {
  typ: "GOAE_KATALOG" | "EBM_KATALOG" | "ADMIN" | "TEXT";
  ref?: string;
};

export type NutzerAktion = "akzeptieren" | "ablehnen" | "modifizieren";

export interface PruefItem {
  ziffer: string;
  regelwerk: Regelwerk;
  kennzeichnung: KennzeichnungStufe;
  text: string;
  euroBetrag?: number;
  quellen: Quellenreferenz[];
  aktion?: NutzerAktion;
}

export interface KategorieErgebnis {
  kategorie: number;
  titel: string;
  status: KategorieStatus;
  items: PruefItem[];
}

export interface KombinationspflichtCheck {
  ziffer: string;
  pflichtKombinationen: {
    erforderlicheZiffer: string;
    grund: string;
    vorhanden: boolean;
    euroBetrag: number;
  }[];
  fehlendePflichtZiffern: string[];
  hinweis: string;
}

export interface DualOption {
  primaer: {
    ziffer: string;
    faktor?: number;
    euroBetrag: number;
    begruendung: string;
    confidence: number;
  };
  alternativ: {
    ziffer: string;
    faktor?: number;
    euroBetrag: number;
    begruendung: string;
    confidence: number;
  };
  erklaerung: string;
}

export interface AlternativVorschlag {
  ziffer: string;
  regelwerk: Regelwerk;
  faktor?: number;
  euroBetrag: number;
  begruendung: string;
  vorteil: string;
  nachteil: string;
  dokumentationsAnforderung: string;
}

export interface DokumentationsBeispiel {
  ziffer: string;
  regelwerk: Regelwerk;
  titel: string;
  mindestAnforderungen: string[];
  beispielText: string;
  beispielVarianten: { kontext: string; text: string }[];
  tipps: string[];
}

export interface DaumenFeedback {
  responseId: string;
  rating: -1 | 1;
  comment?: string;
}

export interface VorschlagFeedback {
  vorschlagId: string;
  responseId: string;
  aktion: "accepted" | "rejected" | "modified";
  modifiedTo?: string;
  fachgebiet?: string;
}

export interface EinwilligungsHinweis {
  positionIndex: number;
  text: string;
  quelle: string;
}

/** SSE `docbill_analyse` — Spec 02, gleiche Form wie Edge `analyse-envelope.ts`. */
export interface DocbillAnalyseV1 {
  version: 1;
  mode: AnalyseModus;
  regelwerk: Regelwerk;
  kategorien: KategorieErgebnis[];
  dualOptions: DualOption[];
  einwilligungsHinweise: EinwilligungsHinweis[];
  disclaimer: string;
  metadata?: {
    inputType?: string;
    detectedPadFormat?: string | null;
  };
}
