/**
 * Pseudonymisiert OpenRouter-/Chat-Completions-Nachrichten (string content oder multimodal-Parts).
 */
import { pseudonymizeForLlmSession } from "./pseudonymize-orchestrator.ts";
import type { PseudonymRequestContext } from "./pseudonym-request-context.ts";

export async function pseudonymizeOpenRouterMessages(
  messages: unknown[],
  ctx: PseudonymRequestContext,
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") {
      out.push(m);
      continue;
    }
    const msg = m as Record<string, unknown>;
    const content = msg.content;
    if (typeof content === "string") {
      const r = await pseudonymizeForLlmSession({
        plaintext: content,
        sessionId: ctx.sessionId,
        apiKey: ctx.apiKey,
        model: ctx.model,
      });
      out.push({ ...msg, content: r.text });
      continue;
    }
    if (Array.isArray(content)) {
      const newParts = await Promise.all(
        content.map(async (part) => {
          if (!part || typeof part !== "object") return part;
          const p = part as Record<string, unknown>;
          if (p.type === "text" && typeof p.text === "string") {
            const r = await pseudonymizeForLlmSession({
              plaintext: p.text,
              sessionId: ctx.sessionId,
              apiKey: ctx.apiKey,
              model: ctx.model,
            });
            return { ...p, text: r.text };
          }
          return part;
        }),
      );
      out.push({ ...msg, content: newParts });
      continue;
    }
    out.push(m);
  }
  return out;
}
