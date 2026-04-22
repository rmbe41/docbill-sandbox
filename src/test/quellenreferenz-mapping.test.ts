import { describe, expect, it } from "vitest";
import { toSpec05Quelle } from "@/lib/knowledge/quellenreferenzMapping";
import type { Quellenreferenz } from "@/lib/analyse/types";

describe("quellen mapping (Spec 7.5 vs Analyse)", () => {
  it("maps GOAE_KATALOG to goae_ziffer", () => {
    const q: Quellenreferenz = { typ: "GOAE_KATALOG", ref: "5" };
    const s = toSpec05Quelle(q);
    expect(s.typ).toBe("goae_ziffer");
    expect(s.referenz).toBe("5");
  });

  it("maps EBM_KATALOG to ebm_gop", () => {
    const s = toSpec05Quelle({ typ: "EBM_KATALOG", ref: "01420" });
    expect(s.typ).toBe("ebm_gop");
    expect(s.referenz).toBe("01420");
  });
});
