/**
 * Spec 04 – Rechnungserstellung & Export (Datenstrukturen).
 * Cross-Ref Kennzeichnung: 02 §4.5; Patient: vgl. 02 ParsedInvoiceInput.
 */

import type { EinwilligungsHinweis, KennzeichnungStufe, Regelwerk } from "@/lib/analyse/types";

/** 02/06 – pseudonymisiert, ohne Namens-PII in Standardfeldern. */
export interface PseudonymizedPatient {
  pseudonymId: string;
  geburtsjahr?: number;
}

/** Spec 04 `Kennzeichnung` = dieselbe Stufen-Union wie `KennzeichnungStufe` (02 §4.5). */
export type Kennzeichnung = KennzeichnungStufe;

/**
 * Eine abrechnungsfertige Rechnungsposition (Spec 04).
 * Faktor nur GOÄ, Punktzahl nur EBM.
 */
export interface RechnungsPosition {
  ziffer: string;
  beschreibung: string;
  faktor?: number;
  punktzahl?: number;
  anzahl: number;
  einzelbetrag: number;
  gesamtbetrag: number;
  begruendung?: string;
  isAnalog: boolean;
  kennzeichnung: Kennzeichnung;
}

export interface RechnungsHinweis {
  positionIndex: number;
  typ: "info" | "warnung" | "pflicht";
  text: string;
}

export type RechnungsentwurfStatus = "fertig" | "exportiert";

/**
 * Rechnungsentwurf nach Analyse & Nutzerbestätigung (Spec 04).
 */
export interface Rechnungsentwurf {
  id: string;
  batchId?: string;
  patient: PseudonymizedPatient;
  regelwerk: Regelwerk;
  positionen: RechnungsPosition[];
  gesamtbetrag: number;
  status: RechnungsentwurfStatus;
  erstelltAm: string;
  hinweise: RechnungsHinweis[];
  einwilligungsHinweise: EinwilligungsHinweis[];
}

export type { EinwilligungsHinweis };
