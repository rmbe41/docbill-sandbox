import { describe, expect, it } from "vitest";
import { pruefeRechnung, pruefeServiceBillingVorschlaege } from "../../supabase/functions/goae-chat/pipeline/regelengine.ts";
import type {
  GoaeMappingResult,
  GoaeZuordnung,
  MedizinischeAnalyse,
  ParsedRechnung,
} from "../../supabase/functions/goae-chat/pipeline/types.ts";

function leereAnalyse(): MedizinischeAnalyse {
  return {
    diagnosen: [],
    behandlungen: [],
    klinischerKontext: "",
    fachgebiet: "Allgemein",
  };
}

describe("pruefeRechnung Ausschlüsse", () => {
  it("meldet Ausschlussfehler für GOÄ 1 und 3 auf derselben Rechnung", () => {
    const PUNKT = 0.0582873;
    const faktor = 2.3;
    const rechnung: ParsedRechnung = {
      positionen: [
        {
          nr: 1,
          ziffer: "1",
          bezeichnung: "Beratung",
          faktor,
          betrag: Math.round(80 * PUNKT * faktor * 100) / 100,
          anzahl: 1,
        },
        {
          nr: 2,
          ziffer: "3",
          bezeichnung: "Eingehende Beratung",
          faktor,
          betrag: Math.round(150 * PUNKT * faktor * 100) / 100,
          anzahl: 1,
        },
      ],
      diagnosen: [],
      rawText: "",
    };
    const mappings: GoaeMappingResult = { zuordnungen: [], fehlendeMappings: [] };
    const out = pruefeRechnung(rechnung, leereAnalyse(), mappings, "");
    const ausschluesse = out.positionen.flatMap((p) =>
      p.pruefungen.filter((x) => x.typ === "ausschluss"),
    );
    expect(ausschluesse.length).toBeGreaterThanOrEqual(2);
    const mitFehler = ausschluesse.filter((x) => x.schwere === "fehler");
    const mitVorschlagSeite = ausschluesse.filter((x) => x.schwere === "warnung");
    expect(mitFehler.length).toBeGreaterThanOrEqual(1);
    expect(mitVorschlagSeite.length).toBeGreaterThanOrEqual(1);
    expect(out.positionen.some((p) => p.status === "fehler")).toBe(true);
    expect(out.positionen.some((p) => p.status === "warnung")).toBe(true);
  });

  it("bei gleichem Betrag für 1+3 streicht die niedrigere Ziffer von der korrigierten Summe (behält berechneten Betrag der höheren Ziffer)", () => {
    const PUNKT = 0.0582873;
    const faktor = 2.3;
    const erwartetPos3 = Math.round(150 * PUNKT * faktor * 100) / 100;
    const rechnung: ParsedRechnung = {
      positionen: [
        {
          nr: 1,
          ziffer: "1",
          bezeichnung: "Beratung",
          faktor,
          betrag: 10,
          anzahl: 1,
        },
        {
          nr: 2,
          ziffer: "3",
          bezeichnung: "Eingehende Beratung",
          faktor,
          betrag: 10,
          anzahl: 1,
        },
      ],
      diagnosen: [],
      rawText: "",
    };
    const mappings: GoaeMappingResult = { zuordnungen: [], fehlendeMappings: [] };
    const out = pruefeRechnung(rechnung, leereAnalyse(), mappings, "");
    expect(out.zusammenfassung.korrigierteSumme).toBe(erwartetPos3);
  });

  it("meldet Ausschlussfehler für GOÄ 1256 und 1257 auf derselben Rechnung", () => {
    const PUNKT = 0.0582873;
    const faktor = 1.8;
    const rechnung: ParsedRechnung = {
      positionen: [
        {
          nr: 1,
          ziffer: "1256",
          bezeichnung: "Tonometrische Untersuchung Applanation",
          faktor,
          betrag: Math.round(100 * PUNKT * faktor * 100) / 100,
          anzahl: 1,
        },
        {
          nr: 2,
          ziffer: "1257",
          bezeichnung: "Tonometrische Kurve",
          faktor,
          betrag: Math.round(242 * PUNKT * faktor * 100) / 100,
          anzahl: 1,
        },
      ],
      diagnosen: [],
      rawText: "",
    };
    const mappings: GoaeMappingResult = { zuordnungen: [], fehlendeMappings: [] };
    const out = pruefeRechnung(rechnung, leereAnalyse(), mappings, "");
    const ausschluesse = out.positionen.flatMap((p) =>
      p.pruefungen.filter((x) => x.typ === "ausschluss"),
    );
    expect(ausschluesse.length).toBeGreaterThanOrEqual(1);
    expect(
      ausschluesse.some((x) => x.nachricht.includes("1256") && x.nachricht.includes("1257")),
    ).toBe(true);
  });

  it("schlägt keine fehlende Ziffer vor, die mit abgerechneter Position kollidiert", () => {
    const PUNKT = 0.0582873;
    const faktor = 2.3;
    const rechnung: ParsedRechnung = {
      positionen: [
        {
          nr: 1,
          ziffer: "1",
          bezeichnung: "Beratung",
          faktor,
          betrag: Math.round(80 * PUNKT * faktor * 100) / 100,
          anzahl: 1,
        },
      ],
      diagnosen: [],
      rawText: "",
    };
    const zuordnungen: GoaeZuordnung[] = [
      {
        leistung: "Eingehende Beratung",
        ziffer: "3",
        bezeichnung: "Eingehende Beratung",
        istAnalog: false,
        konfidenz: "hoch",
      },
    ];
    const mappings: GoaeMappingResult = { zuordnungen, fehlendeMappings: [] };
    const out = pruefeRechnung(rechnung, leereAnalyse(), mappings, "");
    expect(out.optimierungen.some((o) => o.ziffer === "3")).toBe(false);
  });
});

describe("pruefeServiceBillingVorschlaege", () => {
  it("bei 1+3 Service-Billing wird nur die niedriger bewertete Ziffer (1) aus den Vorschlägen gestrichen", () => {
    const zuordnungen: GoaeZuordnung[] = [
      {
        leistung: "Beratung",
        ziffer: "1",
        bezeichnung: "Beratung",
        istAnalog: false,
        konfidenz: "hoch",
      },
      {
        leistung: "Eingehend",
        ziffer: "3",
        bezeichnung: "Eingehende Beratung",
        istAnalog: false,
        konfidenz: "hoch",
      },
    ];
    const { excludedZiffern } = pruefeServiceBillingVorschlaege(
      zuordnungen,
      leereAnalyse(),
      "",
    );
    expect(excludedZiffern.has("1")).toBe(true);
    expect(excludedZiffern.has("3")).toBe(false);
  });
});
