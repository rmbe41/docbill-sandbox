import { describe, expect, it } from "vitest";
import { normalizeFrageAnswerParsed, stripFrageListKorrektZusatzLabels } from "@/lib/frageAnswerStructured";

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

describe("normalizeFrageAnswerParsed", () => {
  it("sanitizes erlaeuterung and grenzfaelle", () => {
    const a = normalizeFrageAnswerParsed({
      kurzantwort: "Kurz.",
      erlaeuterung: "Zusatz: Hinweis.",
      grenzfaelle_hinweise: "Korrekt: Nur allgemein.",
      quellen: [],
    });
    expect(a).not.toBeNull();
    expect(a!.erlaeuterung).toBe("- Hinweis.");
    expect(a!.grenzfaelle_hinweise).toBe("- Nur allgemein.");
  });
});
