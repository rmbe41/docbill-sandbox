import { describe, expect, it } from "vitest";
import { handleGoaeSseDataLine, type SseHandlerContext } from "@/lib/goaeChatSse";
import type { Engine3ResultData } from "@/lib/engine3Result";

const minimalEngine3: Engine3ResultData = {
  modus: "rechnung_pruefung",
  klinischerKontext: "x",
  fachgebiet: "x",
  positionen: [
    {
      nr: 1,
      ziffer: "1",
      bezeichnung: "t",
      faktor: 1,
      betrag: 1,
      status: "korrekt",
      quelleText: "q",
    },
  ],
  hinweise: [],
  optimierungen: [],
  zusammenfassung: {
    geschaetzteSumme: 1,
    anzahlPositionen: 1,
    fehler: 0,
    warnungen: 0,
  },
  quellen: [],
};

describe("SSE multi-case Engine 3", () => {
  it("accumulates engine3_case_result and engine3_batch_complete", () => {
    const state = {
      assistantContent: "",
    };
    const ctx: SseHandlerContext = {
      state,
      onProgress: () => {},
      onDelta: () => {},
    };

    handleGoaeSseDataLine(
      JSON.stringify({
        type: "engine3_case_result",
        caseId: "a",
        caseIndex: 1,
        totalCases: 2,
        title: "Eins",
        filenames: ["a.pdf"],
        data: minimalEngine3,
      }),
      ctx,
    );
    handleGoaeSseDataLine(
      JSON.stringify({
        type: "engine3_case_result",
        caseId: "b",
        caseIndex: 2,
        totalCases: 2,
        title: "Zwei",
        filenames: ["b.pdf"],
        data: { ...minimalEngine3, positionen: [{ ...minimalEngine3.positionen[0], nr: 2, ziffer: "2" }] },
      }),
      ctx,
    );

    expect(ctx.state.engine3Cases?.length).toBe(2);
    expect(ctx.state.engine3Cases?.[0]?.caseId).toBe("a");

    handleGoaeSseDataLine(
      JSON.stringify({
        type: "engine3_batch_complete",
        totalCases: 2,
        cases: [
          { caseId: "a", caseIndex: 1, title: "Eins", filenames: ["a.pdf"], data: minimalEngine3 },
          {
            caseId: "b",
            caseIndex: 2,
            title: "Zwei",
            filenames: ["b.pdf"],
            data: { ...minimalEngine3, positionen: [{ ...minimalEngine3.positionen[0], nr: 2, ziffer: "2" }] },
          },
        ],
      }),
      ctx,
    );

    expect(ctx.state.engine3Cases?.length).toBe(2);
    expect(ctx.state.engine3Data?.positionen[0]?.ziffer).toBe("1");
  });
});
