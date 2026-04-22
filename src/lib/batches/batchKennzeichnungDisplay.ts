import type { KennzeichnungStufe } from "@/lib/analyse/types";
import { KENNZEICHNUNG_PILL } from "@/lib/analyse/pillStyles";

/** Stapel-Box: 03 zeigt [Pflicht fehlt] statt [Unvollständig] */
export function batchPillDisplayLabel(kenn: KennzeichnungStufe): string {
  if (kenn === "UNVOLLSTÄNDIG") return "Pflicht fehlt";
  return KENNZEICHNUNG_PILL[kenn].label;
}

export function kennFromLegacyPill(pill: string): KennzeichnungStufe {
  switch (pill) {
    case "Sicher":
      return "SICHER";
    case "Optimierung":
      return "OPTIMIERUNG";
    case "Prüfen":
      return "PRÜFEN";
    case "Risiko":
      return "RISIKO";
    case "Fehler":
      return "FEHLER";
    case "Pflicht fehlt":
      return "UNVOLLSTÄNDIG";
    default:
      return "PRÜFEN";
  }
}
