import { describe, expect, it } from "vitest";
import { pruefeRechnungEbm } from "../../supabase/functions/goae-chat/pipeline/ebm-regelengine.ts";
import type { MedizinischeAnalyse, ParsedRechnung } from "../../supabase/functions/goae-chat/pipeline/types.ts";

const analyse: MedizinischeAnalyse = {
  diagnosen: [],
  behandlungen: [],
  klinischerKontext: "",
  fachgebiet: "Allgemein",
};

describe("pruefeRechnungEbm", () => {
  it("meldet Ausschluss wenn zwei kollidierende GOPs auf der Rechnung stehen", () => {
    const rechnung: ParsedRechnung = {
      positionen: [
        {
          nr: 1,
          ziffer: "01100",
          bezeichnung: "Test A",
          faktor: 1,
          betrag: 24.97,
          anzahl: 1,
        },
        {
          nr: 2,
          ziffer: "01101",
          bezeichnung: "Test B",
          faktor: 1,
          betrag: 39.88,
          anzahl: 1,
        },
      ],
      diagnosen: [],
      rawText: "",
    };
    const pr = pruefeRechnungEbm(rechnung, analyse, {
      zuordnungen: [],
      fehlendeMappings: [],
    });
    const all = pr.positionen.flatMap((p) => p.pruefungen);
    expect(all.some((x) => x.typ === "ebm_ausschluss")).toBe(true);
  });

  it("meldet Betragsabweichung wenn Euro nicht zum Katalog passt", () => {
    const rechnung: ParsedRechnung = {
      positionen: [
        {
          nr: 1,
          ziffer: "01100",
          bezeichnung: "Test",
          faktor: 1,
          betrag: 1.0,
          anzahl: 1,
        },
      ],
      diagnosen: [],
      rawText: "",
    };
    const pr = pruefeRechnungEbm(rechnung, analyse, {
      zuordnungen: [],
      fehlendeMappings: [],
    });
    const p0 = pr.positionen[0];
    expect(p0?.pruefungen.some((x) => x.typ === "ebm_betrag")).toBe(true);
  });
});
