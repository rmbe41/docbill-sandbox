export type DraftPosition = {
  id: string;
  code: string;
  factor: number;
  count?: number;
  timestamp?: string;
  durationMin?: number;
  amountClaimed?: number;
  notes?: string;
};

export type DraftContext = {
  setting?: "ambulant" | "stationaer" | "op" | "unknown";
  specialty?: string;
  patientAge?: number;
  treatmentDate?: string;
  caseId?: string;
};

export type BillingDraft = {
  positions: DraftPosition[];
  context: DraftContext;
};

export type SourceRef = {
  documentId: string;
  locator?: string;
};

export type ValidationFinding = {
  findingId: string;
  severity: "error" | "warning" | "info";
  category:
    | "zielleistung"
    | "ausschluss"
    | "zeit"
    | "faktor"
    | "frequenz"
    | "kontext"
    | "zuschlag"
    | "analog"
    | "rechenfehler";
  positionIds: string[];
  codeRefs: string[];
  message: string;
  legalRefs: string[];
  sourceRefs: SourceRef[];
  suggestedAction?: {
    action: "remove" | "replace" | "adjust_factor" | "add_justification" | "manual_review";
    payload?: Record<string, unknown>;
  };
};

export type FactorSuggestion = {
  positionId: string;
  code: string;
  factor: number;
  snippets: string[];
  confidence: number;
  sourceRefs: SourceRef[];
};

export type ValidationResult = {
  valid: boolean;
  complianceScore: number;
  findings: ValidationFinding[];
  factorSuggestions: FactorSuggestion[];
  correctedDraft?: BillingDraft;
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
};

export type GoaeV2Code = {
  code: string;
  title: string;
  fee: {
    points: number;
    simple: number;
    thresholdFactor: number;
    thresholdAmount: number;
    maxFactor: number;
    maxAmount: number;
  };
  billingExclusions: {
    targetCode?: string;
    reason: string;
  }[];
};

export type GoaeV2Rule = {
  ruleId: string;
  ruleType: string;
  appliesTo: string[];
  humanExplanation: string;
  legalRefs: string[];
  sourceRef: SourceRef[];
};

export type GoaeV2AnalogMapping = {
  analogId: string;
  originCode: string;
  analogServiceDescription: string;
  pkvPosition: "allowed" | "not_allowed" | "conditionally_allowed" | "unclear";
  pkvReasoning: string;
  pkvReasonCategory: string[];
  sourceRef: SourceRef[];
};

export type GoaeV2SearchIndexEntry = {
  entityType: "code" | "rule" | "analogMapping";
  entityId: string;
  plainTextContext: string;
};

export type ValidationDeps = {
  pointValue: number;
  codeById: Map<string, GoaeV2Code>;
  analogMappings: GoaeV2AnalogMapping[];
  rules: GoaeV2Rule[];
  searchIndex: GoaeV2SearchIndexEntry[];
};

