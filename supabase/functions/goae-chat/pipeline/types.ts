/**
 * Pipeline-Typen für die strukturierte Rechnungsprüfung.
 *
 * Fluss:  Rechnung → Parser → NLP → Extraktion → Mapping → Regelengine → Textgenerierung
 */

// ---------------------------------------------------------------------------
// Step 0 – Eingabe
// ---------------------------------------------------------------------------

export interface PipelineInput {
  files: FilePayload[];
  userMessage?: string;
  conversationHistory?: { role: string; content: string }[];
  model: string;
  extraRules?: string;
}

export interface FilePayload {
  name: string;
  type: string;
  data: string; // base64
}

// ---------------------------------------------------------------------------
// Step 1 – Dokument Parser
// ---------------------------------------------------------------------------

export interface Stammdaten {
  praxis?: { name?: string; adresse?: string; telefon?: string; email?: string; steuernummer?: string };
  patient?: { name?: string; adresse?: string; geburtsdatum?: string };
  bank?: { iban?: string; bic?: string; bankName?: string; kontoinhaber?: string };
  rechnungsnummer?: string;
  rechnungsdatum?: string;
}

export interface ParsedRechnung {
  positionen: RechnungsPosition[];
  diagnosen: string[];
  datum?: string;
  freitext?: string;
  rawText: string;
  stammdaten?: Stammdaten;
  /** Bei getrennter Extraktion (Rechnung + Akte/Befund): nur klinischer Teil, nicht Rechnungszeilen */
  klinischeDokumentation?: string;
}

export interface RechnungsPosition {
  nr: number;
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  datum?: string;
  begruendung?: string;
  anzahl: number;
}

// ---------------------------------------------------------------------------
// Step 2 – Medizinisches NLP
// ---------------------------------------------------------------------------

export interface MedizinischeAnalyse {
  diagnosen: Diagnose[];
  behandlungen: Behandlung[];
  klinischerKontext: string;
  fachgebiet: string;
}

export interface Diagnose {
  text: string;
  icdCode?: string;
  sicherheit: "gesichert" | "verdacht" | "ausschluss";
}

export interface Behandlung {
  text: string;
  typ: "untersuchung" | "therapie" | "beratung" | "operation" | "diagnostik" | "sachkosten";
}

// ---------------------------------------------------------------------------
// Step 3 – Leistungs-Extraktion
// ---------------------------------------------------------------------------

export interface ExtrahierteLeistung {
  bezeichnung: string;
  beschreibung: string;
  quellePositionNr?: number;
  quelleBehandlung?: string;
}

// ---------------------------------------------------------------------------
// Step 4 – GOÄ Mapping
// ---------------------------------------------------------------------------

export interface GoaeZuordnung {
  leistung: string;
  ziffer: string;
  bezeichnung: string;
  istAnalog: boolean;
  analogBegruendung?: string;
  konfidenz: "hoch" | "mittel" | "niedrig";
  alternativZiffern?: string[];
}

export interface GoaeMappingResult {
  zuordnungen: GoaeZuordnung[];
  fehlendeMappings: string[];
}

// ---------------------------------------------------------------------------
// Step 5 – Regelengine
// ---------------------------------------------------------------------------

export interface Pruefung {
  typ:
    | "ausschluss"
    | "betrag"
    | "schwellenwert"
    | "hoechstsatz"
    | "doppelt"
    | "begruendung_fehlt"
    | "analog"
    | "zielleistung"
    | "faktor_erhoehung_empfohlen";
  schwere: "fehler" | "warnung" | "info";
  nachricht: string;
  vorschlag?: string;
  /** Übernehmbare Begründung für die Rechnung (bei Faktor-Erhöhung) */
  begruendungVorschlag?: string;
  /** Neuer Faktor (bei Faktor-Erhöhung/-Reduktion) */
  neueFaktor?: number;
  /** Neuer Betrag (bei Faktor-/Betragsänderung) */
  neuerBetrag?: number;
}

export interface GeprueftePosition {
  nr: number;
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  berechneterBetrag: number;
  status: "korrekt" | "warnung" | "fehler";
  pruefungen: Pruefung[];
  begruendung?: string;
}

export interface Optimierung {
  typ:
    | "fehlende_ziffer"
    | "bessere_ziffer"
    | "faktor_erhoehung"
    | "analog_empfehlung";
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  begruendung: string;
}

export interface RegelpruefungErgebnis {
  positionen: GeprueftePosition[];
  optimierungen: Optimierung[];
  zusammenfassung: {
    gesamt: number;
    korrekt: number;
    warnungen: number;
    fehler: number;
    rechnungsSumme: number;
    korrigierteSumme: number;
    optimierungsPotenzial: number;
  };
}

// ---------------------------------------------------------------------------
// Step 6 – Gesamtergebnis (an den Text-Generator übergeben)
// ---------------------------------------------------------------------------

export interface PipelineResult {
  parsedRechnung: ParsedRechnung;
  medizinischeAnalyse: MedizinischeAnalyse;
  leistungen: ExtrahierteLeistung[];
  mappings: GoaeMappingResult;
  pruefung: RegelpruefungErgebnis;
}

// ---------------------------------------------------------------------------
// Service Billing – Optimierungsziele
// ---------------------------------------------------------------------------

export type OptimizeFor = "korrekt" | "maximaler_umsatz" | "gute_begruendungen";

// ---------------------------------------------------------------------------
// Progress-Events (für SSE an Frontend)
// ---------------------------------------------------------------------------

export interface PipelineProgress {
  step: number;
  totalSteps: number;
  label: string;
}
