import { describe, expect, it } from "vitest";
import {
  stripDuplicateBegruendungPrefix,
  isFaktorUeberSchwelle,
  formatBegruendungFuerPdf,
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
});
