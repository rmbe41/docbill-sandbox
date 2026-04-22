import { ANALYSE_KATEGORIEN_TITEL } from "./kategorien";
import type { KategorieErgebnis } from "./types";

/** Platzhalter-Aggregat: acht Kategorien, „ok“, leer — bis Engine-Outputs gemappt werden. */
export function buildEmptyKategorieErgebnisse(): KategorieErgebnis[] {
  return ANALYSE_KATEGORIEN_TITEL.map((titel, i) => ({
    kategorie: i + 1,
    titel,
    status: "ok" as const,
    items: [],
  }));
}
