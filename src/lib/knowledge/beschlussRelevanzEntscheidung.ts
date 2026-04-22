import type { BeschlussAktion } from "./spec05Types";

/**
 * Entscheidungslogik Spec 7.3 (BÄK/BA Relevanzfilter):
 * - Score ≥ 0,8 und betroffene Ziffern → auto_import
 * - Score 0,5–0,8 oder nur Fachgebiet → manual_review
 * - Score < 0,5 → skip
 *
 * Nicht in der Spec: exakte Behandlung von „Score ≥ 0,8 ohne Ziffern“.
 * Konservativ: wie zweite Zeile (manuelle Prüfung).
 */
export function entscheideBeschlussAktion(input: {
  score: number;
  hatBetroffeneZiffern: boolean;
}): BeschlussAktion {
  const { score, hatBetroffeneZiffern } = input;
  if (score < 0.5) {
    return "skip";
  }
  if (score >= 0.8 && hatBetroffeneZiffern) {
    return "auto_import";
  }
  return "manual_review";
}
