import { describe, expect, it } from "vitest";
import {
  frageAnswerSuggestsExportFinalize,
  normalizeFrageAnswerParsed,
  stripFrageListKorrektZusatzLabels,
} from "@/lib/frageAnswerStructured";

describe("stripFrageListKorrektZusatzLabels", () => {
  it("removes Korrekt:/Zusatz: with various markdown forms", () => {
    const raw = [
      "Korrekt: Meine Funktionsweise basiert auf GOÄ.",
      "- **Zusatz:** Admin-Kontext einbeziehen.",
      "- Korrekt: Ziffern erklären.",
      "",
    ].join("\n");
    const s = stripFrageListKorrektZusatzLabels(raw);
    expect(s).not.toMatch(/Korrekt:\s*/i);
    expect(s).not.toMatch(/Zusatz:\s*/i);
    expect(s).toContain("- Meine Funktionsweise");
    expect(s).toContain("- Admin-Kontext");
    expect(s).toContain("- Ziffern");
  });

  it("leaves Fehler: and normal wording intact", () => {
    expect(stripFrageListKorrektZusatzLabels("- **Fehler:** Ausschluss.")).toBe(
      "- **Fehler:** Ausschluss.",
    );
    expect(stripFrageListKorrektZusatzLabels("- Korrekte Ziffernwahl prüfen.")).toBe(
      "- Korrekte Ziffernwahl prüfen.",
    );
    expect(stripFrageListKorrektZusatzLabels("Korrekt: **Hinweis** im Satz.")).toBe(
      "- **Hinweis** im Satz.",
    );
  });
});

describe("frageAnswerSuggestsExportFinalize", () => {
  it("is true when GOÄ or Ziffer context appears", () => {
    expect(
      frageAnswerSuggestsExportFinalize({
        kurzantwort: "GOÄ 1\n\n- Text",
      }),
    ).toBe(true);
  });
  it("is false for generic text", () => {
    expect(
      frageAnswerSuggestsExportFinalize({
        kurzantwort: "Hallo\n\nNur allgemeine Infos.",
      }),
    ).toBe(false);
  });
});

describe("normalizeFrageAnswerParsed", () => {
  it("merges legacy fields into kurzantwort and sanitizes", () => {
    const a = normalizeFrageAnswerParsed({
      kurzantwort: "Kurz.",
      erlaeuterung: "Zusatz: Hinweis.",
      grenzfaelle_hinweise: "Korrekt: Nur allgemein.",
      quellen: [],
    });
    expect(a).not.toBeNull();
    expect(a!.kurzantwort).toContain("Kurz.");
    expect(a!.kurzantwort).toContain("- Hinweis.");
    expect(a!.kurzantwort).toContain("- Nur allgemein.");
  });

  it("accepts minimal JSON with only kurzantwort", () => {
    const a = normalizeFrageAnswerParsed({
      kurzantwort: "- Eins.\n- Zwei.",
    });
    expect(a).toEqual({ kurzantwort: "- Eins.\n- Zwei." });
  });
});
