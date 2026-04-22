import { describe, expect, it } from "vitest";
import {
  applyEngine3AusschlussPass,
  type Engine3ResultData,
} from "../../supabase/functions/goae-chat/pipeline/engine3/validate.ts";

const PUNKT = 0.0582873;
const F = 2.3;

function baseResult(overrides: Partial<Engine3ResultData>): Engine3ResultData {
  return {
    modus: "rechnung_pruefung",
    klinischerKontext: "Test",
    fachgebiet: "Allgemein",
    hinweise: [],
    zusammenfassung: {
      geschaetzteSumme: 0,
      anzahlPositionen: 0,
      fehler: 0,
      warnungen: 0,
    },
    ...overrides,
    positionen: overrides.positionen ?? [],
  };
}

describe("applyEngine3AusschlussPass", () => {
  it("adds Hinweis und streicht die schwächere Position bei GOÄ 1 und 3 im selben Ergebnis", () => {
    const betrag1 = Math.round(80 * PUNKT * F * 100) / 100;
    const betrag3 = Math.round(150 * PUNKT * F * 100) / 100;
    const raw = baseResult({
      positionen: [
        {
          nr: 1,
          ziffer: "1",
          bezeichnung: "Beratung",
          faktor: F,
          betrag: betrag1,
          status: "korrekt",
        },
        {
          nr: 2,
          ziffer: "3",
          bezeichnung: "Eingehende Beratung",
          faktor: F,
          betrag: betrag3,
          status: "korrekt",
        },
      ],
    });

    const out = applyEngine3AusschlussPass(raw);

    const excl13 = out.hinweise.find((h) => h.titel.includes("1") && h.titel.includes("3"));
    expect(excl13).toBeDefined();
    expect(excl13?.betrifftPositionen?.sort((a, b) => a - b)).toEqual([1, 2]);
    expect(out.positionen).toHaveLength(1);
    expect(out.positionen[0].ziffer).toBe("3");
    expect(out.positionen[0].status).toBe("korrekt");
  });

  it("im Leistungsmodus Schwelle warnung statt fehler", () => {
    const raw = baseResult({
      modus: "leistungen_abrechnen",
      positionen: [
        {
          nr: 1,
          ziffer: "1",
          bezeichnung: "Beratung",
          faktor: F,
          betrag: Math.round(80 * PUNKT * F * 100) / 100,
          status: "korrekt",
        },
        {
          nr: 2,
          ziffer: "3",
          bezeichnung: "Eingehende Beratung",
          faktor: F,
          betrag: Math.round(150 * PUNKT * F * 100) / 100,
          status: "korrekt",
        },
      ],
    });

    const out = applyEngine3AusschlussPass(raw);
    const conflict = out.hinweise.find((h) => h.titel.includes("Ausschluss"));
    expect(conflict?.schwere).toBe("warnung");
    expect(conflict?.betrifftPositionen?.sort((a, b) => a - b)).toEqual([1, 2]);
    expect(out.positionen).toHaveLength(1);
    expect(out.positionen[0].ziffer).toBe("3");
  });

  it("adds Hinweis und streicht die schwächere Position bei GOÄ 1256 und 1257 (Tonometrie)", () => {
    const fMt = 1.8;
    const betrag1256 = Math.round(100 * PUNKT * fMt * 100) / 100;
    const betrag1257 = Math.round(242 * PUNKT * fMt * 100) / 100;
    const raw = baseResult({
      positionen: [
        {
          nr: 1,
          ziffer: "1256",
          bezeichnung: "Applanationstonometrie",
          faktor: fMt,
          betrag: betrag1256,
          status: "korrekt",
        },
        {
          nr: 2,
          ziffer: "1257",
          bezeichnung: "Tonometrie-Kurve",
          faktor: fMt,
          betrag: betrag1257,
          status: "korrekt",
        },
      ],
    });

    const out = applyEngine3AusschlussPass(raw);

    const excl1256 = out.hinweise.find((h) => h.titel.includes("1256") && h.titel.includes("1257"));
    expect(excl1256).toBeDefined();
    expect(excl1256?.betrifftPositionen?.sort((a, b) => a - b)).toEqual([1, 2]);
    expect(out.positionen).toHaveLength(1);
    expect(out.positionen[0].ziffer).toBe("1257");
  });

  it("streicht GOÄ 1202 neben 1201 (subj. vs obj. Refraktion)", () => {
    const f = F;
    const b1201 = Math.round(89 * PUNKT * f * 100) / 100;
    const b1202 = Math.round(74 * PUNKT * f * 100) / 100;
    const raw = baseResult({
      positionen: [
        {
          nr: 1,
          ziffer: "1201",
          bezeichnung: "Subjektiv",
          faktor: f,
          betrag: b1201,
          status: "korrekt",
        },
        {
          nr: 2,
          ziffer: "1202",
          bezeichnung: "Objektiv",
          faktor: f,
          betrag: b1202,
          status: "korrekt",
        },
      ],
    });

    const out = applyEngine3AusschlussPass(raw);

    expect(out.positionen).toHaveLength(1);
    expect(out.positionen[0].ziffer).toBe("1201");
    const excl12 = out.hinweise.find((h) => h.titel.includes("1201") && h.titel.includes("1202"));
    expect(excl12).toBeDefined();
    expect(excl12?.betrifftPositionen?.sort((a, b) => a - b)).toEqual([1, 2]);
  });
});
