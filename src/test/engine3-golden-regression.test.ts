import { describe, expect, it } from "vitest";
import {
  buildRegelKatalogMapFromJson,
  GOAE_REFRACT_SUBJ_OBJ_EXCLUSIVE,
  GOAE_TONOMETRIE_MUTUALLY_EXCLUSIVE,
  regelZiffernKollidieren,
} from "../../supabase/functions/goae-chat/goae-catalog-json.ts";

/**
 * Kompakte Regression: kritischer Regelkatalog-Zustand (Patches + JSON),
 * unabhängig vom LLM. Ergänzt punktuelle Fälle in engine3-ausschluss-pass / regelengine-ausschluss.
 */
describe("Engine3 golden regression (Regelkatalog)", () => {
  it("exportiert die Tonometrie-Clique wie im Plan dokumentiert", () => {
    expect(GOAE_TONOMETRIE_MUTUALLY_EXCLUSIVE.has("1255")).toBe(true);
    expect(GOAE_TONOMETRIE_MUTUALLY_EXCLUSIVE.has("1256")).toBe(true);
    expect(GOAE_TONOMETRIE_MUTUALLY_EXCLUSIVE.has("1257")).toBe(true);
  });

  it("Tonometrie-Ziffern kollidieren paarweise im effektiven Regelkatalog", () => {
    const map = buildRegelKatalogMapFromJson();
    expect(regelZiffernKollidieren(map, "1256", "1257")).toBe(true);
    expect(regelZiffernKollidieren(map, "1255", "1257")).toBe(true);
    expect(regelZiffernKollidieren(map, "1255", "1256")).toBe(true);
  });

  it("Beratung 1/3 bleibt ausgeschlossen (Referenz-Regression)", () => {
    const map = buildRegelKatalogMapFromJson();
    expect(regelZiffernKollidieren(map, "1", "3")).toBe(true);
  });

  it("Refraktion 1201/1202 kollidiert im effektiven Regelkatalog", () => {
    expect(GOAE_REFRACT_SUBJ_OBJ_EXCLUSIVE.has("1201")).toBe(true);
    expect(GOAE_REFRACT_SUBJ_OBJ_EXCLUSIVE.has("1202")).toBe(true);
    const map = buildRegelKatalogMapFromJson();
    expect(regelZiffernKollidieren(map, "1201", "1202")).toBe(true);
  });
});
