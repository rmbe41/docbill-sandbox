import { describe, expect, it } from "vitest";
import {
  enforceEngine3Quellenbezug,
  toClientEngine3Result,
  type Engine3ResultData,
} from "../../supabase/functions/goae-chat/pipeline/engine3/validate.ts";

function fullBase(overrides: Partial<Engine3ResultData> = {}): Engine3ResultData {
  const base: Engine3ResultData = {
    modus: "rechnung_pruefung",
    klinischerKontext: "Kurz aus Prüfung",
    fachgebiet: "Augen",
    positionen: [
      {
        nr: 1,
        ziffer: "1",
        bezeichnung: "Beratung",
        faktor: 2.3,
        betrag: 12.34,
        status: "korrekt",
        quelleText: "Zeile 1 Rechnung",
        anmerkung: "Notiz",
      },
    ],
    hinweise: [
      { schwere: "fehler", titel: "A", detail: "d1", betrifftPositionen: [1] },
      { schwere: "warnung", titel: "B", detail: "d2" },
      { schwere: "info", titel: "Info", detail: "nur intern" },
    ],
    optimierungen: [
      {
        nr: 2,
        ziffer: "750",
        bezeichnung: "Zuschlag",
        faktor: 1,
        betrag: 5,
        status: "vorschlag",
        begruendung: "lang",
      },
    ],
    zusammenfassung: {
      geschaetzteSumme: 17.34,
      anzahlPositionen: 1,
      fehler: 1,
      warnungen: 3,
    },
    goaeStandHinweis: "Stand x",
    adminQuellen: ["doc.pdf"],
    quellen: ["Systemquelle"],
  };
  return { ...base, ...overrides, positionen: overrides.positionen ?? base.positionen };
}

describe("toClientEngine3Result", () => {
  it("liefert quelleText, quellen; entfernt Info-Hinweise und übrige Metadaten", () => {
    const slim = toClientEngine3Result(fullBase());
    expect(slim).toEqual({
      modus: "rechnung_pruefung",
      klinischerKontext: "Kurz aus Prüfung",
      fachgebiet: "Augen",
      positionen: [
        {
          nr: 1,
          ziffer: "1",
          bezeichnung: "Beratung",
          faktor: 2.3,
          betrag: 12.34,
          status: "korrekt",
          quelleText: "Zeile 1 Rechnung",
        },
      ],
      hinweise: [
        { schwere: "fehler", titel: "A", detail: "d1", betrifftPositionen: [1] },
        { schwere: "warnung", titel: "B", detail: "d2" },
      ],
      optimierungen: [
        {
          nr: 2,
          ziffer: "750",
          bezeichnung: "Zuschlag",
          faktor: 1,
          betrag: 5,
          status: "vorschlag",
        },
      ],
      zusammenfassung: {
        geschaetzteSumme: 17.34,
        anzahlPositionen: 1,
        fehler: 1,
        warnungen: 3,
      },
      quellen: ["Systemquelle"],
    });
  });

  it("enforceEngine3Quellenbezug ergänzt fehlendes quelleText", () => {
    const raw = fullBase({
      positionen: [
        {
          nr: 1,
          ziffer: "1",
          bezeichnung: "Beratung",
          faktor: 2.3,
          betrag: 12.34,
          status: "korrekt",
        },
      ],
    });
    const fixed = enforceEngine3Quellenbezug(raw);
    expect(fixed.positionen[0]?.quelleText).toContain("GOÄ-Katalog");
    expect(fixed.positionen[0]?.status).toBe("warnung");
    expect(fixed.positionen[0]?.anmerkung).toContain("quelleText");
  });

  it("lässt optimierungen weg wenn leer", () => {
    const slim = toClientEngine3Result(
      fullBase({
        optimierungen: undefined,
        hinweise: [{ schwere: "warnung", titel: "x", detail: "y" }],
      }),
    );
    expect(slim.optimierungen).toBeUndefined();
  });
});
