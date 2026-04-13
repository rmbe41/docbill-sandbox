/** Partition der Datei-Indizes (0..n-1), gleiche Logik wie Edge `validateEngine3CaseGroups`. */
export function validateEngine3CaseGroups(nFiles: number, groups: number[][] | undefined): number[][] | null {
  if (!groups?.length || nFiles < 1) return null;
  const used = new Set<number>();
  for (const g of groups) {
    if (!Array.isArray(g) || g.length === 0) return null;
    for (const i of g) {
      if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= nFiles) return null;
      if (used.has(i)) return null;
      used.add(i);
    }
  }
  if (used.size !== nFiles) return null;
  return groups;
}
