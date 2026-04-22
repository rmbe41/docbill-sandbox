import { describe, expect, it } from "vitest";
import { DOCBILL_KI_DISCLAIMER } from "@/lib/rechnung/docbillDisclaimer";
import {
  rechnungsentwurfToCsv,
  rechnungsentwurfToPadBlock,
} from "@/lib/rechnung/rechnungsentwurfExport";
import type { Rechnungsentwurf } from "@/lib/rechnung/rechnungsentwurfTypes";

const minimal: Rechnungsentwurf = {
  id: "r1",
  patient: { pseudonymId: "P-1" },
  regelwerk: "GOAE",
  positionen: [
    {
      ziffer: "1",
      beschreibung: "Test",
      anzahl: 1,
      einzelbetrag: 10,
      gesamtbetrag: 10,
      isAnalog: false,
      kennzeichnung: "SICHER",
      faktor: 2.3,
    },
  ],
  gesamtbetrag: 10,
  status: "fertig",
  erstelltAm: "2026-04-22T12:00:00.000Z",
  hinweise: [],
  einwilligungsHinweise: [],
};

describe("Spec 04 export", () => {
  it("CSV endet mit Disclaimer (Spec 00)", () => {
    const csv = rechnungsentwurfToCsv(minimal);
    expect(csv).toContain("DISCLAIMER");
    expect(csv).toContain(DOCBILL_KI_DISCLAIMER);
  });
  it("PAD-Block enthält Disclaimer", () => {
    const s = rechnungsentwurfToPadBlock(minimal);
    expect(s).toContain("DISCLAIMER=" + DOCBILL_KI_DISCLAIMER);
  });
});
