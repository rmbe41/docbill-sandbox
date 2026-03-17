/**
 * Input-Parser für Service Billing
 *
 * Extrahiert optimize_for aus der Nutzer-Nachricht (heuristisch).
 * Steuert Faktor-Optimierung und Max-Umsatz-Modus.
 */

import type { OptimizeFor } from "./types.ts";

const MAXIMAL_KEYWORDS = [
  "maximal",
  "maximaler umsatz",
  "maximal abrechnen",
  "alles abrechnen",
  "höchstmöglich",
  "optimieren",
  "mehr abrechnen",
  "voll abrechnen",
];

const KORREKT_KEYWORDS = [
  "korrekt",
  "sicher",
  "regelkonform",
  "vorsichtig",
  "konservativ",
];

const BEGRUENDUNG_KEYWORDS = [
  "gute begründung",
  "gute begründungen",
  "begründungen",
  "begründung qualität",
];

/**
 * Extrahiert Optimierungsziele aus der Nutzer-Nachricht.
 */
export function extrahiereOptimizeFor(userMessage: string): OptimizeFor[] {
  const msg = (userMessage || "").toLowerCase().trim();
  if (msg.length === 0) return [];

  const result: OptimizeFor[] = [];

  if (MAXIMAL_KEYWORDS.some((k) => msg.includes(k))) {
    result.push("maximaler_umsatz");
  }
  if (KORREKT_KEYWORDS.some((k) => msg.includes(k))) {
    result.push("korrekt");
  }
  if (BEGRUENDUNG_KEYWORDS.some((k) => msg.includes(k))) {
    result.push("gute_begruendungen");
  }

  if (result.length === 0) {
    result.push("korrekt");
  }

  return result;
}
