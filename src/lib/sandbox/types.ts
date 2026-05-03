/** DocBill Sandbox v0.2 — siehe specs/09_SANDBOX_PROTOTYPE.md */

export type InsuranceType = "GKV" | "PKV" | "self";

/** GKV → EBM; PKV/Selbstzahler → GOÄ — nicht mischen */
export type BillingBasis = "statutory" | "private";

export function billingBasisFromInsurance(ins: InsuranceType): BillingBasis {
  return ins === "GKV" ? "statutory" : "private";
}

export type EncounterType = "Erstkontakt" | "Folge" | "Notfall" | "Vorsorge";

export type DocStatus = "draft" | "proposed" | "invoiced";

export type InvoiceStatus = "proposed" | "approved" | "sent" | "paid" | "denied" | "appealed";

export type ConfidenceLevel = "high" | "medium" | "low";

export type SandboxProvider = {
  id: string;
  name: string;
};

export type SandboxPatient = {
  id: string;
  name: string;
  dob: string;
  insurance_type: InsuranceType;
  insurance_number: string;
  insurance_provider: string;
  insurance_status?: string;
  /** Stammdaten (optional; ältere LocalStorage-Snapshots ohne diese Felder) */
  gender?: string;
  street?: string;
  postal_code?: string;
  city?: string;
  phone?: string;
  email?: string;
  /** Versicherung */
  insurance_member_since?: string;
  /** Institutionskennzeichen der Krankenkasse (GKV-Demo) */
  insurance_ik?: string;
};

export type SandboxDocumentation = {
  id: string;
  patient_id: string;
  date: string;
  provider_id: string;
  encounter_type: EncounterType;
  anamnesis: string;
  findings: string;
  diagnosis_text: string;
  therapy: string;
  status: DocStatus;
  /** gesetzt durch Testdaten-Generator oder implizit beim Vorschlag */
  case_id?: string;
  created_at: string;
};

export type ServiceItemEbm = {
  code: string;
  label: string;
  amount_eur?: number;
  points?: number;
};

export type ServiceItemGoae = {
  code: string;
  label: string;
  factor: number;
  amount: number;
  /** Pflichtig bei Steigerung über den Schwellensatz der Ziffer (GOÄ); siehe Katalog `thresholdFactor` */
  factor_justification?: string;
};

export type TimelineEntry = {
  ts: string;
  event: string;
  actor: string;
};

export type SandboxInvoice = {
  id: string;
  documentation_id: string;
  patient_id: string;
  billing_basis: BillingBasis;
  service_items_ebm: ServiceItemEbm[];
  service_items_goae: ServiceItemGoae[];
  total_amount: number;
  status: InvoiceStatus;
  sent_via?: string;
  timeline: TimelineEntry[];
  /** Fallback-Schwierigkeit des Demo-Falls; steuert Konfidenz im Prototyp */
  billing_difficulty: "easy" | "medium" | "hard";
  /** niedrigste Konfidenzstufe für Karten-Dot (aus billing_difficulty abgeleitet) */
  confidence_tier: ConfidenceLevel;
  /** Prototyp: Score 0–100 (kein echtes Modell) */
  confidence_percent: number;
  /** Kurzlabel für Karte: nur EBM oder nur GOÄ je nach Kostenträger */
  card_code_summary: string;
};

/** Markierung im Freitext der Akte; ref kann EBM oder GOÄ bezeichnen — Abrechnung bleibt getrennt */
export type HighlightSnippet = {
  field: "anamnesis" | "findings" | "diagnosis_text" | "therapy";
  snippet: string;
  ref: string;
};

export type SandboxBillingCaseDocumentation = {
  encounter_type: EncounterType;
  anamnesis: string;
  findings: string;
  diagnosis_text: string;
  therapy: string;
};

export type SandboxBillingCase = {
  id: string;
  difficulty: "easy" | "medium" | "hard";
  patient_profile_id?: string;
  documentation: SandboxBillingCaseDocumentation;
  highlights?: HighlightSnippet[];
  service_items_ebm: ServiceItemEbm[];
  service_items_goae: ServiceItemGoae[];
  total_amount: number;
  meta?: { notes?: string };
};

export type SandboxSeedState = {
  practice_line: string;
  providers: SandboxProvider[];
  patients: SandboxPatient[];
  documentations: SandboxDocumentation[];
  invoices: SandboxInvoice[];
};
