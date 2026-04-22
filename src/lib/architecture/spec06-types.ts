/**
 * Typen aus `specs/06_ARCHITECTURE.md` (Abschnitt 8) — kanonische Spiegelung für Frontend/Shared-Code.
 *
 * EBM-Laufzeitdaten entsprechen strukturell `supabase/functions/goae-chat/ebm-catalog-json.ts` (`EbmDatenbank`).
 */

// --- 8.2 PseudonymMap ---

export type PseudonymType =
  | "person"
  | "date"
  | "insurance_id"
  | "address"
  | "phone"
  | "email";

export interface PseudonymMappingEntry {
  original: string;
  pseudonym: string;
  type: PseudonymType;
}

export interface PseudonymMap {
  sessionId: string;
  mappings: PseudonymMappingEntry[];
  expiresAt: string;
}

// --- 8.4 EnrichedChunk ---

export interface EnrichedChunkMetadata {
  source: "BAEK" | "KBV_BA" | "USER_UPLOAD";
  organisationId?: string;
  documentId: string;
  ziffer?: string;
  fachgebiete?: string[];
  version: string;
  gueltigAb?: string;
  gueltigBis?: string;
  schlagworte: string[];
}

export interface EnrichedChunk {
  id: string;
  content: string;
  metadata: EnrichedChunkMetadata;
  relatedChunkIds?: string[];
}

// --- 8.6 Session ---
// `Message` ist in der Spec nicht weiter aufgeschlüsselt; Mindestfelder für Konversationspersistenz.

export interface SessionMessage {
  id: string;
  role: string;
  content: string;
}

export type Message = SessionMessage;

export interface Session {
  id: string;
  userId: string;
  organisationId: string;
  mode: "A" | "B" | "C" | "BATCH";
  regelwerk: "GOAE" | "EBM";
  batchId?: string;
  messages: Message[];
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  pseudonymMap?: PseudonymMap;
}

// --- 8.7 EBM ---

export interface EBMGebuerenordnungsposition {
  gop: string;
  bezeichnung: string;
  kapitel: string;
  punktzahl: number;
  euroWert: number;
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

export interface EBMKapitel {
  nummer: string;
  bezeichnung: string;
  versorgungsbereich: "hausaerztlich" | "fachaerztlich" | "uebergreifend";
  praeambel: string;
  gops: string[];
}

export interface EBMBestimmung {
  nummer: string;
  titel: string;
  inhalt: string;
  betroffeneGops?: string[];
}

export interface EBMDatenbank {
  version: string;
  gueltigAb: string;
  orientierungswert: number;
  allgemeineBestimmungen: EBMBestimmung[];
  kapitel: EBMKapitel[];
  gops: EBMGebuerenordnungsposition[];
}
