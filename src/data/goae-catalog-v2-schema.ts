import { z } from "zod";

export const GOAE_RULE_TYPES = [
  "exclusion",
  "required_context",
  "time_minimum",
  "analog_restriction",
  "zielleistungsprinzip",
] as const;

export const GOAE_RULE_SCOPES = ["global", "section", "code"] as const;

export const GOAE_CODE_TYPES = ["numeric", "surcharge", "letter", "special"] as const;

export const GOAE_PKV_POSITIONS = [
  "allowed",
  "not_allowed",
  "conditionally_allowed",
  "unclear",
] as const;

export const GOAE_PKV_REASON_CATEGORIES = [
  "keine_luecke",
  "zielleistungsprinzip",
  "nicht_selbststaendig",
  "organisationsleistung",
  "einschraenkung_originar",
  "beratungsleistung_originar",
  "nicht_aerztliche_leistung",
  "medizinische_notwendigkeit_offen",
  "sonstiges",
] as const;

export type GoaeRuleType = (typeof GOAE_RULE_TYPES)[number];
export type GoaeRuleScope = (typeof GOAE_RULE_SCOPES)[number];
export type GoaeCodeType = (typeof GOAE_CODE_TYPES)[number];
export type GoaePkvPosition = (typeof GOAE_PKV_POSITIONS)[number];
export type GoaePkvReasonCategory = (typeof GOAE_PKV_REASON_CATEGORIES)[number];

export type GoaeV2SourceRef = {
  documentId: string;
  page?: number;
  locator?: string;
  quote?: string;
};

export type GoaeV2Fee = {
  points: number;
  simple: number;
  thresholdFactor: number;
  thresholdAmount: number;
  maxFactor: number;
  maxAmount: number;
};

export type GoaeV2BillingExclusion = {
  type: "code_conflict" | "section_conflict" | "rule";
  targetCode?: string;
  targetRuleId?: string;
  reason: string;
};

export type GoaeV2Code = {
  code: string;
  codeType: GoaeCodeType;
  status: "active";
  sectionId: string;
  title: string;
  descriptionLong?: string;
  serviceComponents: string[];
  tags: string[];
  medicalDomain: string[];
  fee: GoaeV2Fee;
  billingPrerequisites: string[];
  billingExclusions: GoaeV2BillingExclusion[];
  billingInclusions: string[];
  frequencyLimits: string[];
  timeConstraints: string[];
  settingConstraints: string[];
  legalRefs: string[];
  sourceRef: GoaeV2SourceRef[];
  confidence: number;
  extractionNotes?: string;
};

export type GoaeV2Section = {
  id: string;
  chapterCode: string;
  subsectionCode: string | null;
  title: string;
  parentId: string | null;
  sourceRef: GoaeV2SourceRef[];
};

export type GoaeV2Rule = {
  ruleId: string;
  ruleType: GoaeRuleType;
  scope: GoaeRuleScope;
  appliesTo: string[];
  logic: Record<string, unknown>;
  humanExplanation: string;
  legalRefs: string[];
  sourceRef: GoaeV2SourceRef[];
};

export type GoaeV2AnalogMapping = {
  analogId: string;
  analogCode: string;
  originCode: string;
  originDescription: string;
  analogServiceDescription: string;
  pkvPosition: GoaePkvPosition;
  pkvReasoning: string;
  pkvReasonCategory: GoaePkvReasonCategory[];
  crossRefs: string[];
  sourceRef: GoaeV2SourceRef[];
};

export type GoaeV2TermIndex = {
  canonicalTerm: string;
  synonyms: string[];
  abbreviations: string[];
  mapsTo: {
    entityType: "code" | "rule" | "analogMapping" | "section";
    entityId: string;
  }[];
};

export type GoaeV2SearchIndexEntry = {
  entityType: "code" | "rule" | "analogMapping";
  entityId: string;
  title: string;
  plainTextContext: string;
  keywords: string[];
  embeddingText?: string;
};

export type GoaeV2Catalog = {
  schemaVersion: "2.0.0";
  generatedAt: string;
  sourceDocuments: {
    documentId: string;
    title: string;
    version?: string;
    extractedAt?: string;
  }[];
  metadata: {
    recordCounts: {
      sections: number;
      codes: number;
      rules: number;
      analogMappings: number;
      termIndex: number;
      searchIndex: number;
    };
  };
  sections: GoaeV2Section[];
  codes: GoaeV2Code[];
  rules: GoaeV2Rule[];
  analogMappings: GoaeV2AnalogMapping[];
  termIndex: GoaeV2TermIndex[];
  searchIndex: GoaeV2SearchIndexEntry[];
};

const sourceRefSchema = z.object({
  documentId: z.string().min(1),
  page: z.number().int().positive().optional(),
  locator: z.string().min(1).optional(),
  quote: z.string().min(1).optional(),
});

export const goaeV2Schema = z.object({
  schemaVersion: z.literal("2.0.0"),
  generatedAt: z.string().datetime(),
  sourceDocuments: z.array(
    z.object({
      documentId: z.string().min(1),
      title: z.string().min(1),
      version: z.string().min(1).optional(),
      extractedAt: z.string().datetime().optional(),
    }),
  ),
  metadata: z.object({
    recordCounts: z.object({
      sections: z.number().int().nonnegative(),
      codes: z.number().int().nonnegative(),
      rules: z.number().int().nonnegative(),
      analogMappings: z.number().int().nonnegative(),
      termIndex: z.number().int().nonnegative(),
      searchIndex: z.number().int().nonnegative(),
    }),
  }),
  sections: z.array(
    z.object({
      id: z.string().min(1),
      chapterCode: z.string().min(1),
      subsectionCode: z.string().min(1).nullable(),
      title: z.string().min(1),
      parentId: z.string().min(1).nullable(),
      sourceRef: z.array(sourceRefSchema),
    }),
  ),
  codes: z.array(
    z.object({
      code: z.string().min(1),
      codeType: z.enum(GOAE_CODE_TYPES),
      status: z.literal("active"),
      sectionId: z.string().min(1),
      title: z.string().min(1),
      descriptionLong: z.string().optional(),
      serviceComponents: z.array(z.string()),
      tags: z.array(z.string()),
      medicalDomain: z.array(z.string()),
      fee: z.object({
        points: z.number(),
        simple: z.number(),
        thresholdFactor: z.number(),
        thresholdAmount: z.number(),
        maxFactor: z.number(),
        maxAmount: z.number(),
      }),
      billingPrerequisites: z.array(z.string()),
      billingExclusions: z.array(
        z.object({
          type: z.enum(["code_conflict", "section_conflict", "rule"]),
          targetCode: z.string().optional(),
          targetRuleId: z.string().optional(),
          reason: z.string(),
        }),
      ),
      billingInclusions: z.array(z.string()),
      frequencyLimits: z.array(z.string()),
      timeConstraints: z.array(z.string()),
      settingConstraints: z.array(z.string()),
      legalRefs: z.array(z.string()),
      sourceRef: z.array(sourceRefSchema),
      confidence: z.number().min(0).max(1),
      extractionNotes: z.string().optional(),
    }),
  ),
  rules: z.array(
    z.object({
      ruleId: z.string().min(1),
      ruleType: z.enum(GOAE_RULE_TYPES),
      scope: z.enum(GOAE_RULE_SCOPES),
      appliesTo: z.array(z.string()),
      logic: z.record(z.unknown()),
      humanExplanation: z.string().min(1),
      legalRefs: z.array(z.string()),
      sourceRef: z.array(sourceRefSchema),
    }),
  ),
  analogMappings: z.array(
    z.object({
      analogId: z.string().min(1),
      analogCode: z.string().min(1),
      originCode: z.string().min(1),
      originDescription: z.string().min(1),
      analogServiceDescription: z.string().min(1),
      pkvPosition: z.enum(GOAE_PKV_POSITIONS),
      pkvReasoning: z.string().min(1),
      pkvReasonCategory: z.array(z.enum(GOAE_PKV_REASON_CATEGORIES)),
      crossRefs: z.array(z.string()),
      sourceRef: z.array(sourceRefSchema),
    }),
  ),
  termIndex: z.array(
    z.object({
      canonicalTerm: z.string().min(1),
      synonyms: z.array(z.string()),
      abbreviations: z.array(z.string()),
      mapsTo: z.array(
        z.object({
          entityType: z.enum(["code", "rule", "analogMapping", "section"]),
          entityId: z.string().min(1),
        }),
      ),
    }),
  ),
  searchIndex: z.array(
    z.object({
      entityType: z.enum(["code", "rule", "analogMapping"]),
      entityId: z.string().min(1),
      title: z.string().min(1),
      plainTextContext: z.string().min(1),
      keywords: z.array(z.string()),
      embeddingText: z.string().optional(),
    }),
  ),
});

