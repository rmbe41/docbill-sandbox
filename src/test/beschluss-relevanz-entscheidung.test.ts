import { describe, it, expect } from "vitest";
import { entscheideBeschlussAktion } from "@/lib/knowledge/beschlussRelevanzEntscheidung";

describe("entscheideBeschlussAktion (Spec 7.3)", () => {
  it("auto_import bei Score ≥ 0,8 und Ziffern", () => {
    expect(entscheideBeschlussAktion({ score: 0.8, hatBetroffeneZiffern: true })).toBe("auto_import");
    expect(entscheideBeschlussAktion({ score: 0.95, hatBetroffeneZiffern: true })).toBe("auto_import");
  });

  it("skip bei Score < 0,5", () => {
    expect(entscheideBeschlussAktion({ score: 0.49, hatBetroffeneZiffern: true })).toBe("skip");
    expect(entscheideBeschlussAktion({ score: 0, hatBetroffeneZiffern: false })).toBe("skip");
  });

  it("manual_review bei Score 0,5–0,8 (Band)", () => {
    expect(entscheideBeschlussAktion({ score: 0.5, hatBetroffeneZiffern: true })).toBe("manual_review");
    expect(entscheideBeschlussAktion({ score: 0.7, hatBetroffeneZiffern: true })).toBe("manual_review");
    expect(entscheideBeschlussAktion({ score: 0.8, hatBetroffeneZiffern: false })).toBe("manual_review");
  });
});
