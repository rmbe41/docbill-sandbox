/** Kanonische Zeile für TXT/PDF/PAD-DAT-Export aus strukturierten Ergebnissen. */
export type BillingExportRow = {
  nr: number;
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  quelleText?: string;
  begruendung?: string;
};
