import { describe, expect, it } from "vitest";
import {
  extractBeratungsMinutenAusText,
  getBegruendungBeispiele,
  getBegruendungBeispieleTriple,
  getSteigerungFallbackBeispiel,
} from "./goae-begruendung-beispiele";

describe("getBegruendungBeispiele", () => {
  it("liefert genau drei Varianten für GOÄ 1207", () => {
    const a = getBegruendungBeispiele("1207", 2.3);
    const b = getBegruendungBeispiele("1207", 3.5);
    expect(a.length).toBe(3);
    expect(b.length).toBe(3);
    expect(a[0].length).toBeGreaterThan(80);
  });

  it("liefert drei Varianten für GOÄ 1 (Beratung) mit Minutenbezug", () => {
    const a = getBegruendungBeispiele("1", 2.4);
    expect(a.length).toBe(3);
    expect(a.every((t) => t.includes("GOÄ 1"))).toBe(true);
    expect(a.every((t) => t.includes("15–20 Minuten") || t.includes("Gesprächsdauer"))).toBe(true);
  });

  it("übernimmt Minuten aus dem Quelltext bei Beratung", () => {
    const t = getBegruendungBeispiele("3", 2.4, { quelleText: "Eingehende Beratung ca. 22 Min." });
    expect(t.length).toBe(3);
    expect(t[0]).toContain("22 Minuten");
  });

  it("liefert drei Varianten für GOÄ 1225 (Kampimetrie/Perimetrie)", () => {
    const a = getBegruendungBeispiele("1225", 2.9);
    expect(a.length).toBe(3);
    expect(a.some((t) => t.includes("Kampimetrie") || t.includes("Perimetrie"))).toBe(true);
  });

  it("rotiert die Auswahl bei rotation>0", () => {
    const r0 = getBegruendungBeispiele("1207", 2.3, { rotation: 0 });
    const r1 = getBegruendungBeispiele("1207", 2.3, { rotation: 1 });
    expect(r0[0]).not.toBe(r1[0]);
  });

  it("liefert leeres Array für unbekannte Ziffer", () => {
    expect(getBegruendungBeispiele("9999", 2.3)).toEqual([]);
  });

  it("getBegruendungBeispieleTriple nutzt LLM-Liste ohne Kanon", () => {
    const triple = getBegruendungBeispieleTriple(
      {
        ziffer: "9999",
        faktor: 2.3,
        begruendungBeispiele: ["a", "b", "c", "d", "e"],
      },
      0,
    );
    expect(triple).toEqual(["a", "b", "c"]);
  });

  it("extractBeratungsMinutenAusText erkennt Bereich und Einzelwert", () => {
    expect(extractBeratungsMinutenAusText("Beratung 15–20 Min.")).toBe("15–20 Minuten");
    expect(extractBeratungsMinutenAusText("Dauer 18 Minuten")).toBe("18 Minuten");
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
