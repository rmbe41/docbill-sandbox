import { describe, expect, it } from "vitest";
import { parseEngine3ResultData } from "@/lib/engine3Result";

describe("parseEngine3ResultData", () => {
  it("accepts minimal valid Engine 3 JSON", () => {
    const raw = {
      modus: "leistungen_abrechnen",
      klinischerKontext: "Kontrolltermin",
      fachgebiet: "Augenheilkunde",
      positionen: [
        {
          nr: 1,
          ziffer: "1",
          bezeichnung: "Beratung",
          faktor: 2.3,
          betrag: 10.67,
          status: "korrekt",
          quelleText: "Verlauf laut Akte",
        },
      ],
      hinweise: [{ schwere: "info" as const, titel: "Hinweis", detail: "Kurz" }],
      zusammenfassung: {
        geschaetzteSumme: 10.67,
        anzahlPositionen: 1,
        fehler: 0,
        warnungen: 0,
      },
    };
    const p = parseEngine3ResultData(raw);
    expect(p).not.toBeNull();
    expect(p?.modus).toBe("leistungen_abrechnen");
    expect(p?.positionen[0]?.ziffer).toBe("1");
  });

  it("parses betrifftPositionen on hinweise (dedupe, string list)", () => {
    const raw = {
      modus: "leistungen_abrechnen" as const,
      klinischerKontext: "x",
      fachgebiet: "y",
      positionen: [
        { nr: 1, ziffer: "1", bezeichnung: "B", faktor: 1, betrag: 1, status: "korrekt" as const },
      ],
      hinweise: [
        {
          schwere: "warnung" as const,
          titel: "t",
          detail: "d",
          betrifftPositionen: [1, 1, 2],
        },
        { schwere: "info" as const, titel: "u", detail: "e", betrifftPositionen: "3, 4" },
      ],
      zusammenfassung: {
        geschaetzteSumme: 1,
        anzahlPositionen: 1,
        fehler: 0,
        warnungen: 0,
      },
    };
    const p = parseEngine3ResultData(raw);
    expect(p?.hinweise[0]?.betrifftPositionen).toEqual([1, 2]);
    expect(p?.hinweise[1]?.betrifftPositionen).toEqual([3, 4]);
  });

  it("rejects invalid modus", () => {
    expect(parseEngine3ResultData({ modus: "x" })).toBeNull();
  });

  it("coerces numeric ziffer from model JSON", () => {
    const raw = {
      modus: "rechnung_pruefung" as const,
      klinischerKontext: "x",
      fachgebiet: "y",
      positionen: [
        { nr: 1, ziffer: 250, bezeichnung: "Test", faktor: 1, betrag: 1, status: "korrekt" as const },
      ],
      hinweise: [{ schwere: "info" as const, titel: "t", detail: "d" }],
      zusammenfassung: {
        geschaetzteSumme: 1,
        anzahlPositionen: 1,
        fehler: 0,
        warnungen: 0,
      },
    };
    const p = parseEngine3ResultData(raw);
    expect(p?.positionen[0]?.ziffer).toBe("250");
  });

  it("treats null hinweise as empty list", () => {
    const raw = {
      modus: "leistungen_abrechnen" as const,
      klinischerKontext: "x",
      fachgebiet: "y",
      positionen: [],
      hinweise: null,
      zusammenfassung: {
        geschaetzteSumme: 0,
        anzahlPositionen: 0,
        fehler: 0,
        warnungen: 0,
      },
    };
    expect(parseEngine3ResultData(raw)?.hinweise).toEqual([]);
  });

  it("accepts wrapped payload and German decimal betrag", () => {
    const raw = {
      result: {
        modus: "rechnung_pruefung" as const,
        klinischerKontext: "k",
        fachgebiet: "f",
        positionen: [
          {
            nr: 1,
            ziffer: "1",
            bezeichnung: "B",
            faktor: "2,3",
            betrag: "10,55",
            status: "Korrekt",
          },
        ],
        hinweise: [{ schwere: "Info", titel: "t", detail: "d" }],
        zusammenfassung: {
          geschaetzteSumme: "10,55",
          anzahlPositionen: 1,
          fehler: 0,
          warnungen: 0,
        },
      },
    };
    const p = parseEngine3ResultData(raw);
    expect(p).not.toBeNull();
    expect(p?.positionen[0]?.faktor).toBeCloseTo(2.3);
    expect(p?.positionen[0]?.betrag).toBeCloseTo(10.55);
    expect(p?.positionen[0]?.status).toBe("korrekt");
  });

  it("accepts quellen array from server payload", () => {
    const raw = {
      modus: "rechnung_pruefung" as const,
      klinischerKontext: "k",
      fachgebiet: "f",
      positionen: [
        { nr: 1, ziffer: "1", bezeichnung: "B", faktor: 1, betrag: 1, status: "korrekt" as const, quelleText: "Pos. 1" },
      ],
      hinweise: [{ schwere: "info" as const, titel: "t", detail: "d" }],
      zusammenfassung: {
        geschaetzteSumme: 1,
        anzahlPositionen: 1,
        fehler: 0,
        warnungen: 0,
      },
      quellen: ["GOÄ-Regeln (DocBill)", "Interner Kontext: rag-doc.pdf"],
    };
    const p = parseEngine3ResultData(raw);
    expect(p?.quellen).toEqual(["GOÄ-Regeln (DocBill)", "Interner Kontext: rag-doc.pdf"]);
  });

  it("accepts slim SSE payload without Kontext keys and ohne Positions-Extras", () => {
    const raw = {
      modus: "rechnung_pruefung" as const,
      positionen: [
        { nr: 1, ziffer: "5", bezeichnung: "Symptomatik", faktor: 1, betrag: 2.5, status: "warnung" as const },
      ],
      hinweise: [{ schwere: "warnung" as const, titel: "Steigerung", detail: "Begründung prüfen" }],
      zusammenfassung: {
        geschaetzteSumme: 2.5,
        anzahlPositionen: 1,
        fehler: 0,
        warnungen: 2,
      },
    };
    const p = parseEngine3ResultData(raw);
    expect(p).not.toBeNull();
    expect(p?.klinischerKontext).toBe("");
    expect(p?.fachgebiet).toBe("");
    expect(p?.positionen[0]?.quelleText).toBeUndefined();
  });

  it("derives zusammenfassung when object missing", () => {
    const raw = {
      modus: "leistungen_abrechnen" as const,
      klinischerKontext: "",
      fachgebiet: "",
      positionen: [
        { nr: 1, ziffer: "1", bezeichnung: "B", faktor: 1, betrag: 10, status: "korrekt" as const },
      ],
      hinweise: [],
    };
    const p = parseEngine3ResultData(raw);
    expect(p?.zusammenfassung.geschaetzteSumme).toBeCloseTo(10);
    expect(p?.zusammenfassung.anzahlPositionen).toBe(1);
  });

  it("omits quellen when array contains non-strings", () => {
    const raw = {
      modus: "rechnung_pruefung" as const,
      klinischerKontext: "k",
      fachgebiet: "f",
      positionen: [
        { nr: 1, ziffer: "1", bezeichnung: "B", faktor: 1, betrag: 1, status: "korrekt" as const },
      ],
      hinweise: [{ schwere: "info" as const, titel: "t", detail: "d" }],
      zusammenfassung: {
        geschaetzteSumme: 1,
        anzahlPositionen: 1,
        fehler: 0,
        warnungen: 0,
      },
      quellen: ["ok", 1],
    };
    const p = parseEngine3ResultData(raw);
    expect(p).not.toBeNull();
    expect(p?.quellen).toBeUndefined();
  });
});
