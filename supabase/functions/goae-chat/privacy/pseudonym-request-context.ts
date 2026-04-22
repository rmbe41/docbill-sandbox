/**
 * Request-spezifischer Kontext für Pseudonymisierung (Spec 8.2).
 * Ermöglicht zentrales Verhalten in `callLlm` ohne jeden Aufrufer anzupassen.
 *
 * Nutzt Node-kompatibles AsyncLocalStorage (Deno Edge / Supabase Functions).
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type PseudonymRequestContext = {
  sessionId: string;
  apiKey: string;
  model: string;
};

const als = new AsyncLocalStorage<PseudonymRequestContext>();

export function runWithPseudonymRequestContext<T>(
  ctx: PseudonymRequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return als.run(ctx, fn);
}

export function getPseudonymRequestContext(): PseudonymRequestContext | undefined {
  return als.getStore();
}
