import { describe, expect, it } from "vitest";
import {
  mergeNonOverlappingMatches,
  pseudonymizeTextStage1,
  reidentifyMedizinischeAnalyse,
  reidentifyText,
  type PseudonymRawMatch,
} from "@/lib/architecture/pseudonymize-stage1";

describe("pseudonymizeTextStage1 (Spec 8.2 Stufe 1)", () => {
  it("round-trips email and date", () => {
    const raw = "Kontakt: max@example.org am 15.03.2024";
    const sid = "test-session";
    const { text, map } = pseudonymizeTextStage1(raw, sid);
    expect(text).not.toContain("max@example.org");
    expect(text).not.toContain("15.03.2024");
    expect(map.sessionId).toBe(sid);
    expect(map.mappings.length).toBeGreaterThanOrEqual(2);
    expect(reidentifyText(text, map)).toBe(raw);
  });

  it("reidentifies medizinische Analyse fields", () => {
    const sid = "s2";
    const { map } = pseudonymizeTextStage1("x@y.de", sid);
    const a = {
      diagnosen: [{ text: map.mappings[0].pseudonym, sicherheit: "gesichert" as const }],
      behandlungen: [{ text: "ok", typ: "beratung" as const }],
      klinischerKontext: "",
      fachgebiet: "",
    };
    const back = reidentifyMedizinischeAnalyse(a, map);
    expect(back.diagnosen[0].text).toBe("x@y.de");
  });

  it("prefers regex over ner on overlap (Spec 8.2)", () => {
    const overlap: PseudonymRawMatch[] = [
      { start: 0, end: 12, original: "foo@bar.de", type: "email", source: "regex" },
      { start: 0, end: 8, original: "foo@bar", type: "person", source: "ner" },
    ];
    const merged = mergeNonOverlappingMatches(overlap);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("regex");
  });
});
