import type { ChatMessage } from "@/components/ChatBubble";
import type { Json } from "@/integrations/supabase/types";
import { attachmentsToPreviewItems, parseMessageStructured } from "@/lib/messageStructuredContent";

export function dbRowToChatMessage(m: {
  id: string;
  role: string;
  content: string;
  structured_content?: Json | null;
}): ChatMessage {
  const role = m.role === "assistant" ? "assistant" : "user";
  const s = parseMessageStructured(m.structured_content == null ? null : m.structured_content);
  const base: ChatMessage = { id: m.id, role, content: m.content };
  if (!s) return base;
  if (role === "user" && s.attachments?.length) {
    return { ...base, attachments: attachmentsToPreviewItems(s.attachments) };
  }
  if (role === "assistant") {
    return {
      ...base,
      invoiceResult: s.invoiceResult,
      serviceBillingResult: s.serviceBillingResult,
      analysisTimeSeconds: s.analysisTimeSeconds,
      suggestionDecisions: s.suggestionDecisions,
    };
  }
  return base;
}
