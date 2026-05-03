/** DocBill Sandbox v0.2 — siehe specs/09_SANDBOX_PROTOTYPE.md */

export type InsuranceType = "GKV" | "PKV" | "self";

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

export type DiagnosisRow = {
  code: string;
  label: string;
  confidence: ConfidenceLevel;
  rationale: string;
  source_snippet?: string;
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
  diagnosis_codes: DiagnosisRow[];
  service_items_ebm: ServiceItemEbm[];
  service_items_goae: ServiceItemGoae[];
  total_amount: number;
  status: InvoiceStatus;
  sent_via?: string;
  timeline: TimelineEntry[];
  /** niedrigste Diagnose-Konfidenz für Karten-Dot */
  confidence_tier: ConfidenceLevel;
  /** Prototyp: abgeleiteter Score 0–100 aus Diagnose-Konfidenzen (kein echtes Modell) */
  confidence_percent: number;
  /** Kurzlabel für Karte z. B. GOÄ 1 + ICD R51 */
  card_code_summary: string;
};

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
  diagnosis_codes: DiagnosisRow[];
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
