/**
 * Spec 8.2 — Zusammenführung: Stufe 1 (Regex) + Stufe 2 (NER) + Redis (24h).
 */
import type { PseudonymMap } from "../../../../src/lib/architecture/spec06-types.ts";
import {
  collectStage1RegexMatches,
  maskDocbillPlaceholdersForNer,
  mergeAndApplyPseudonymMatches,
  mergeNonOverlappingMatches,
  nextPerTypeCountersFromMap,
  substituteExistingMappingsInText,
} from "./pseudonymize-bridge.ts";
import { collectStage2NerMatches } from "./ner-stage2.ts";
import { loadPseudonymMap, savePseudonymMap } from "./pseudonym-redis.ts";

export async function pseudonymizeForLlmSession(opts: {
  plaintext: string;
  sessionId: string;
  apiKey?: string;
  model?: string;
  /** Ohne Redis: Map aus demselben Request (z. B. vorheriger Teilstring). */
  existingOverride?: PseudonymMap | null;
}): Promise<{ text: string; map: PseudonymMap }> {
  const { plaintext, sessionId, apiKey, model, existingOverride } = opts;
  const fromRedis = await loadPseudonymMap(sessionId);
  const existing = fromRedis ?? existingOverride ?? null;

  const working = substituteExistingMappingsInText(plaintext, existing);
  const maskedForNer = maskDocbillPlaceholdersForNer(working);

  const regexMatches = collectStage1RegexMatches(working);
  const nerMatches = await collectStage2NerMatches(working, maskedForNer, { apiKey, model });

  const merged = mergeNonOverlappingMatches([...regexMatches, ...nerMatches]);
  const startCounters = nextPerTypeCountersFromMap(existing);
  const { text: pseudonymized, map: deltaMap } = mergeAndApplyPseudonymMatches(
    working,
    sessionId,
    merged,
    startCounters,
  );

  const combined: PseudonymMap = {
    sessionId,
    mappings: [...(existing?.mappings ?? []), ...deltaMap.mappings],
    expiresAt: deltaMap.expiresAt,
  };

  await savePseudonymMap(combined);
  return { text: pseudonymized, map: combined };
}
