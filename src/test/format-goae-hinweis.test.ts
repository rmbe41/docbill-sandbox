import { describe, expect, it } from "vitest";
import {
  stripDuplicateBegruendungPrefix,
  isFaktorUeberSchwelle,
  formatBegruendungFuerPdf,
  buildSteigerungsbegruendungVorschlag,
  buildHoechstfaktorHinweisText,
} from "@/lib/format-goae-hinweis";

describe("format-goae-hinweis", () => {
  it("stripDuplicateBegruendungPrefix entfernt führendes Label case-insensitive", () => {
    expect(stripDuplicateBegruendungPrefix("Begründung: Text")).toBe("Text");
    expect(stripDuplicateBegruendungPrefix("begründung:  Text")).toBe("Text");
    expect(stripDuplicateBegruendungPrefix("Begründung Text")).toBe("Text");
    expect(stripDuplicateBegruendungPrefix("  Begründung:\nFoo")).toBe("Foo");
  });

  it("isFaktorUeberSchwelle nutzt Katalog für Ziffer 1 (80 Pkt., Schwelle 2,3)", () => {
    expect(isFaktorUeberSchwelle("1", 2.3)).toBe(false);
    expect(isFaktorUeberSchwelle("1", 2.31)).toBe(true);
  });

  it("formatBegruendungFuerPdf setzt Label nur bei Steigerung", () => {
    expect(formatBegruendungFuerPdf("1", 2.3, "Standard")).toBe("Standard");
    expect(formatBegruendungFuerPdf("1", 2.5, "Langer Aufwand")).toBe(
      "Begründung: Langer Aufwand",
    );
    expect(formatBegruendungFuerPdf("1", 2.5, "Begründung: schon da")).toBe(
      "Begründung: schon da",
    );
  });

  it("buildSteigerungsbegruendungVorschlag bleibt neutral ohne Katalog-Zitat", () => {
    const t = buildSteigerungsbegruendungVorschlag({
      ziffer: "6",
      faktor: 2.4,
      betragFormatted: "13,99 €",
    });
    expect(t).toContain("GOÄ 6");
    expect(t).toContain("2,4");
    expect(t).toContain("Regelhöchstsatz");
    expect(t).toContain("GOÄ-Ziffer 6");
    expect(t).not.toContain("Organsysteme");
    expect(t).toContain("Patientenakte");
  });

  it("buildHoechstfaktorHinweisText verweist auf Honorarvereinbarung", () => {
    const t = buildHoechstfaktorHinweisText("1", 4);
    expect(t).toContain("Höchstfaktor");
    expect(t).toContain("Honorarvereinbarung");
  });
});
