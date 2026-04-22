/**
 * Spec 05 – Wissensbasis & Quellen (specs/05_KNOWLEDGE_BASE.md)
 * Reine Typdefinitionen gemäß Spezifikation.
 */

export type BeschlussQuelle = "BAEK" | "KBV_BA";

export type BeschlussRelevanzKategorie = "direkt_relevant" | "indirekt_relevant" | "nicht_relevant";

export type BeschlussAktion = "auto_import" | "manual_review" | "skip";

/** Spec 7.3 */
export interface BeschlussBewertung {
  beschlussId: string;
  titel: string;
  datum: string;
  quelle: BeschlussQuelle;
  relevanz: {
    score: number;
    kategorie: BeschlussRelevanzKategorie;
    begruendung: string;
  };
  betroffeneZiffern: string[];
  betroffeneFachgebiete: string[];
  aktion: BeschlussAktion;
}

/** Spec 7.5 */
export type QuellenreferenzTyp =
  | "goae_paragraph"
  | "goae_ziffer"
  | "ebm_gop"
  | "ebm_bestimmung"
  | "baek_beschluss"
  | "ba_beschluss"
  | "kommentar";

export interface Quellenreferenz {
  typ: QuellenreferenzTyp;
  referenz: string;
  kurztext: string;
  url?: string;
}

/** Spec 7.4 – hochladbare GOÄ-Kommentarwerke (Sekundärquellen) */
export type KommentarQuelle = "brueck" | "hoffmann" | "lang_schaefer";
