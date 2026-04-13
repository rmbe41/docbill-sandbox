import type { InvoiceResultData } from "@/components/InvoiceResult";
import type { ServiceBillingResultData } from "@/components/ServiceBillingResult";
import type { Engine3ResultData } from "@/lib/engine3Result";
import type { Json } from "@/integrations/supabase/types";
import type { FrageAnswerStructured } from "@/lib/frageAnswerStructured";

export const MESSAGE_STRUCTURED_VERSION = 1 as const;

export type FilePayloadStored = { name: string; type: string; data: string };

/** Ein abgeschlossener Engine-3-Vorgang (eine Prüfeinheit). */
export type Engine3CaseStored = {
  caseId: string;
  caseIndex: number;
  title: string;
  filenames: string[];
  result: Engine3ResultData;
};

/** Offene Segmentierung: Nutzer kann Vorgänge bestätigen und erneut senden. */
export type Engine3SegmentationProposalStored = {
  fileRoles: { index: number; role: string }[];
  cases: { id: string; fileIndices: number[]; title?: string }[];
  confidence: number;
  fileNames: string[];
};

export type MessageStructuredContentV1 = {
  v: typeof MESSAGE_STRUCTURED_VERSION;
  invoiceResult?: InvoiceResultData;
  serviceBillingResult?: ServiceBillingResultData;
  engine3Result?: Engine3ResultData;
  /** Mehrere PDFs / Vorgänge: ein strukturiertes Ergebnis pro Case. */
  engine3Cases?: Engine3CaseStored[];
  engine3SegmentationProposal?: Engine3SegmentationProposalStored;
  analysisTimeSeconds?: number;
  frageAnswer?: FrageAnswerStructured;
  suggestionDecisions?: {
    invoice?: Record<string, string>;
    service?: Record<string, string>;
    /** Engine-3-Positionen: Schlüssel wie `pos:1:123` / `opt:2:456` → pending | accepted | rejected */
    engine3?: Record<string, string>;
  };
  /** Direktmodus Kurzantworten: Status pro Vorschlags-id. */
  kurzantwortenVorschlagStatus?: Record<string, "accepted" | "rejected">;
  /**
   * Engine-3: manuell angepasste Faktoren (Schlüssel wie bei suggestionDecisions.engine3, ggf. Case-Präfix).
   */
  engine3FaktorOverrides?: Record<string, number>;
  attachments?: FilePayloadStored[];
};

/** Patch: `null` entfernt einen gespeicherten Override (Merge in mergeStructuredContent). */
export type Engine3FaktorOverridesPatch = Record<string, number | null>;

function mergeEngine3FaktorMaps(
  base: Record<string, number> | undefined,
  patch: Engine3FaktorOverridesPatch,
): Record<string, number> {
  const out = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

export function parseMessageStructured(
  json: Json | null | undefined,
): MessageStructuredContentV1 | null {
  if (json == null || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (o.v !== MESSAGE_STRUCTURED_VERSION) return null;
  return json as MessageStructuredContentV1;
}

export function attachmentsToPreviewItems(
  attachments: FilePayloadStored[] | undefined,
): { name: string; type: string; previewUrl?: string }[] {
  if (!attachments?.length) return [];
  return attachments.map((a) => ({
    name: a.name,
    type: a.type,
    previewUrl:
      a.type.startsWith("image/") || a.type === "application/pdf"
        ? `data:${a.type};base64,${a.data}`
        : undefined,
  }));
}

export function buildUserStructuredContent(
  filePayloads: FilePayloadStored[],
): MessageStructuredContentV1 | null {
  if (!filePayloads.length) return null;
  return { v: MESSAGE_STRUCTURED_VERSION, attachments: filePayloads };
}

export function buildAssistantStructuredContent(params: {
  invoiceResult?: InvoiceResultData;
  serviceBillingResult?: ServiceBillingResultData;
  engine3Result?: Engine3ResultData;
  engine3Cases?: Engine3CaseStored[];
  engine3SegmentationProposal?: Engine3SegmentationProposalStored;
  analysisTimeSeconds?: number;
  frageAnswer?: FrageAnswerStructured;
  suggestionDecisions?: MessageStructuredContentV1["suggestionDecisions"];
  kurzantwortenVorschlagStatus?: MessageStructuredContentV1["kurzantwortenVorschlagStatus"];
}): MessageStructuredContentV1 | null {
  if (
    params.invoiceResult == null &&
    params.serviceBillingResult == null &&
    params.engine3Result == null &&
    params.engine3Cases == null &&
    params.engine3SegmentationProposal == null &&
    params.analysisTimeSeconds == null &&
    params.frageAnswer == null &&
    params.kurzantwortenVorschlagStatus == null
  ) {
    return null;
  }
  return {
    v: MESSAGE_STRUCTURED_VERSION,
    invoiceResult: params.invoiceResult,
    serviceBillingResult: params.serviceBillingResult,
    engine3Result: params.engine3Result,
    engine3Cases: params.engine3Cases,
    engine3SegmentationProposal: params.engine3SegmentationProposal,
    analysisTimeSeconds: params.analysisTimeSeconds,
    frageAnswer: params.frageAnswer,
    suggestionDecisions: params.suggestionDecisions,
    kurzantwortenVorschlagStatus: params.kurzantwortenVorschlagStatus,
  };
}

export function mergeStructuredContent(
  prev: MessageStructuredContentV1 | null,
  patch: Partial<MessageStructuredContentV1>,
): MessageStructuredContentV1 {
  const base: MessageStructuredContentV1 = prev ?? { v: MESSAGE_STRUCTURED_VERSION };
  const pInv = patch.suggestionDecisions?.invoice;
  const pSvc = patch.suggestionDecisions?.service;
  const pE3 = patch.suggestionDecisions?.engine3;
  const mergedDecisions =
    pInv !== undefined || pSvc !== undefined || pE3 !== undefined || base.suggestionDecisions
      ? {
          invoice: { ...base.suggestionDecisions?.invoice, ...pInv },
          service: { ...base.suggestionDecisions?.service, ...pSvc },
          engine3: { ...base.suggestionDecisions?.engine3, ...pE3 },
        }
      : base.suggestionDecisions;
  const pKurz = patch.kurzantwortenVorschlagStatus;
  const mergedKurz =
    pKurz !== undefined
      ? { ...base.kurzantwortenVorschlagStatus, ...pKurz }
      : base.kurzantwortenVorschlagStatus;
  const pE3Faktor = patch.engine3FaktorOverrides as Engine3FaktorOverridesPatch | undefined;
  const mergedE3Faktor =
    pE3Faktor !== undefined
      ? mergeEngine3FaktorMaps(base.engine3FaktorOverrides, pE3Faktor)
      : base.engine3FaktorOverrides;
  const { suggestionDecisions: _sd, kurzantwortenVorschlagStatus: _kv, engine3FaktorOverrides: _e3f, ...patchRest } =
    patch;
  const mergedEngine3Cases =
    patch.engine3Cases !== undefined ? patch.engine3Cases : base.engine3Cases;
  const mergedSeg =
    patch.engine3SegmentationProposal !== undefined
      ? patch.engine3SegmentationProposal
      : base.engine3SegmentationProposal;
  return {
    ...base,
    ...patchRest,
    v: MESSAGE_STRUCTURED_VERSION,
    suggestionDecisions: mergedDecisions,
    kurzantwortenVorschlagStatus: mergedKurz,
    engine3FaktorOverrides: mergedE3Faktor,
    engine3Cases: mergedEngine3Cases,
    engine3SegmentationProposal: mergedSeg,
  };
}
