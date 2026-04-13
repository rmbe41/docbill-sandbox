import { describe, expect, it } from "vitest";
import { ValidationEngine31 } from "../../supabase/functions/goae-chat/pipeline/engine31/validation-engine.ts";

describe("ValidationEngine31", () => {
  const engine = new ValidationEngine31();

  it("markiert Ausschlusskonflikte fuer 1 und 3", () => {
    const result = engine.validateDraft({
      positions: [
        { id: "p1", code: "1", factor: 2.3 },
        { id: "p2", code: "3", factor: 2.3 },
      ],
      context: { setting: "ambulant" },
    });

    expect(result.valid).toBe(false);
    expect(result.findings.some((f) => f.category === "ausschluss" && f.severity === "error")).toBe(true);
  });

  it("erkennt zielleistungsnahe Teilschritte und markiert nicht berechnungsfaehig", () => {
    const result = engine.validateDraft({
      positions: [{ id: "p1", code: "253", factor: 2.3, notes: "Blutstillung waehrend OP als Teilschritt" }],
      context: { setting: "op" },
    });

    expect(result.findings.some((f) => f.category === "zielleistung" && f.severity === "error")).toBe(true);
    expect((result.correctedDraft?.positions.length ?? 0)).toBe(0);
  });

  it("liefert Zeit- und Faktorpruefungen inklusive Begruendungsvorschlaegen", () => {
    const result = engine.validateDraft({
      positions: [
        { id: "p1", code: "34", factor: 2.8, durationMin: 10 },
        { id: "p2", code: "1", factor: 4.0 },
      ],
      context: { setting: "ambulant", specialty: "innere" },
    });

    expect(result.findings.some((f) => f.category === "zeit" && f.severity === "error")).toBe(true);
    expect(result.findings.some((f) => f.category === "faktor" && f.severity === "error")).toBe(true);
    expect(result.factorSuggestions.length).toBeGreaterThan(0);
    expect(result.factorSuggestions[0].snippets.length).toBeGreaterThan(0);
  });
});

