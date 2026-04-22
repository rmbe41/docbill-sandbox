import { describe, expect, it } from "vitest";
import { buildRechnungsentwurfFromInvoice, pseudonymIdFuerEinzelfall } from "@/lib/rechnung/buildRechnungsentwurfFromInvoice";
import type { InvoiceResultData } from "@/components/InvoiceResult";

const minimalData: InvoiceResultData = {
  positionen: [
    {
      nr: 1,
      ziffer: "1",
      bezeichnung: "Beratung",
      faktor: 2.3,
      betrag: 10.0,
      berechneterBetrag: 10.0,
      status: "korrekt",
      pruefungen: [],
    },
  ],
  optimierungen: [],
  zusammenfassung: {
    gesamt: 1,
    korrekt: 1,
    warnungen: 0,
    fehler: 0,
    rechnungsSumme: 10,
    korrigierteSumme: 10,
    optimierungsPotenzial: 0,
  },
};

describe("buildRechnungsentwurfFromInvoice", () => {
  it("mappt Vorschauzeilen zu Rechnungsentwurf (GOÄ)", () => {
    const e = buildRechnungsentwurfFromInvoice({
      data: minimalData,
      exportRows: [
        {
          nr: 1,
          ziffer: "1",
          bezeichnung: "Beratung",
          faktor: 2.3,
          betrag: 10.0,
          sourcePosNr: 1,
          pruefStatus: "korrekt",
        },
      ],
      gesamtbetrag: 10,
      entwurfId: "t1",
    });
    expect(e.regelwerk).toBe("GOAE");
    expect(e.positionen).toHaveLength(1);
    expect(e.positionen[0]!.faktor).toBe(2.3);
    expect(e.gesamtbetrag).toBe(10);
  });

  it("pseudonymIdFuerEinzelfall", () => {
    expect(pseudonymIdFuerEinzelfall("")).toBe("einzelrechnung");
    expect(pseudonymIdFuerEinzelfall("A/2026-1")).toContain("A");
  });
});
