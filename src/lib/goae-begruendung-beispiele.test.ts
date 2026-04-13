import { describe, expect, it } from "vitest";
import { getBegruendungBeispiele, getSteigerungFallbackBeispiel } from "./goae-begruendung-beispiele";

describe("getBegruendungBeispiele", () => {
  it("liefert fünf Varianten für GOÄ 1207", () => {
    const a = getBegruendungBeispiele("1207", 2.3);
    const b = getBegruendungBeispiele("1207", 3.5);
    expect(a.length).toBe(5);
    expect(b.length).toBe(5);
    expect(a[0].length).toBeGreaterThan(80);
  });

  it("liefert fünf Varianten für GOÄ 1 (Beratung)", () => {
    const a = getBegruendungBeispiele("1", 2.4);
    expect(a.length).toBe(5);
    expect(a.some((t) => t.includes("GOÄ 1"))).toBe(true);
  });

  it("liefert fünf Varianten für GOÄ 1225 (Kampimetrie/Perimetrie)", () => {
    const a = getBegruendungBeispiele("1225", 2.9);
    expect(a.length).toBe(5);
    expect(a.some((t) => t.includes("Kampimetrie") || t.includes("Perimetrie"))).toBe(true);
  });

  it("liefert leeres Array für unbekannte Ziffer", () => {
    expect(getBegruendungBeispiele("9999", 2.3)).toEqual([]);
  });

  it("getSteigerungFallbackBeispiel liefert einen konkreten Absatz mit Kopfzeile", () => {
    const t = getSteigerungFallbackBeispiel({
      ziffer: "1",
      bezeichnung: "Beratung",
      faktor: 2.4,
      betragFormatted: "11,19 €",
    });
    expect(t).toContain("GOÄ 1");
    expect(t).toContain("Faktor 2,4");
    expect(t).toContain("Erhöhter Zeitaufwand");
  });
});
