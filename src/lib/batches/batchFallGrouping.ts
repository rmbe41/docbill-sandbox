import type { GeplanteRechnungEingabe } from "@/lib/batches/planBatchInvoicesFromFiles";
import { patLabelFromText } from "@/lib/batches/planBatchInvoicesFromFiles";

/** Gleiche Pat-ID / Label aus Text → gleicher Fall (heuristisch). */
export function suggestFallKeysFromPlan(plan: GeplanteRechnungEingabe[]): number[] {
  const labels = plan.map((p, i) => patLabelFromText(p.rohText, i));
  const map = new Map<string, number>();
  let next = 0;
  return labels.map((L) => {
    if (!map.has(L)) map.set(L, next++);
    return map.get(L)!;
  });
}

/** Macht Gruppen-IDs lückenlos 0 … k−1 (stabile Reihenfolge). */
export function normalizeFallKeys(keys: number[]): number[] {
  const uniq = [...new Set(keys)].sort((a, b) => a - b);
  const m = new Map(uniq.map((k, i) => [k, i]));
  return keys.map((k) => m.get(k)!);
}

/** Mehrere Planzeilen zu einem Fall (Indizes in die gleiche Gruppe). */
export function mergePlanIndices(fallKeys: number[], selectedIndices: number[]): number[] {
  if (selectedIndices.length < 2) return fallKeys;
  const next = [...fallKeys];
  const canon = Math.min(...selectedIndices.map((i) => next[i]!));
  for (const i of selectedIndices) next[i] = canon;
  return normalizeFallKeys(next);
}
