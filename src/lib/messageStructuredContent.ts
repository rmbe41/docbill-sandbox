import type { InvoiceResultData } from "@/components/InvoiceResult";
import type { ServiceBillingResultData } from "@/components/ServiceBillingResult";
import type { Json } from "@/integrations/supabase/types";
import type { FrageAnswerStructured } from "@/lib/frageAnswerStructured";

export const MESSAGE_STRUCTURED_VERSION = 1 as const;

export type FilePayloadStored = { name: string; type: string; data: string };

export type MessageStructuredContentV1 = {
  v: typeof MESSAGE_STRUCTURED_VERSION;
  invoiceResult?: InvoiceResultData;
  serviceBillingResult?: ServiceBillingResultData;
  analysisTimeSeconds?: number;
  frageAnswer?: FrageAnswerStructured;
  suggestionDecisions?: {
    invoice?: Record<string, string>;
    service?: Record<string, string>;
  };
  attachments?: FilePayloadStored[];
};

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
  analysisTimeSeconds?: number;
  frageAnswer?: FrageAnswerStructured;
  suggestionDecisions?: MessageStructuredContentV1["suggestionDecisions"];
}): MessageStructuredContentV1 | null {
  if (
    params.invoiceResult == null &&
    params.serviceBillingResult == null &&
    params.analysisTimeSeconds == null &&
    params.frageAnswer == null
  ) {
    return null;
  }
  return {
    v: MESSAGE_STRUCTURED_VERSION,
    invoiceResult: params.invoiceResult,
    serviceBillingResult: params.serviceBillingResult,
    analysisTimeSeconds: params.analysisTimeSeconds,
    frageAnswer: params.frageAnswer,
    suggestionDecisions: params.suggestionDecisions,
  };
}

export function mergeStructuredContent(
  prev: MessageStructuredContentV1 | null,
  patch: Partial<MessageStructuredContentV1>,
): MessageStructuredContentV1 {
  const base: MessageStructuredContentV1 = prev ?? { v: MESSAGE_STRUCTURED_VERSION };
  const pInv = patch.suggestionDecisions?.invoice;
  const pSvc = patch.suggestionDecisions?.service;
  const mergedDecisions =
    pInv !== undefined || pSvc !== undefined || base.suggestionDecisions
      ? {
          invoice: { ...base.suggestionDecisions?.invoice, ...pInv },
          service: { ...base.suggestionDecisions?.service, ...pSvc },
        }
      : base.suggestionDecisions;
  return {
    ...base,
    ...patch,
    v: MESSAGE_STRUCTURED_VERSION,
    suggestionDecisions: mergedDecisions,
  };
}
