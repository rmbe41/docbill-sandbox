import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { billingRowsToTsv } from "@/lib/export/exportToTxt";
import type { BillingExportRow } from "@/lib/export/billingExportRow";
import { splitPadDatIntoSegments, joinPadDatSegments } from "@/lib/export/padDatSegments";

describe("billingRowsToTsv", () => {
  it("writes header and rows", () => {
    const rows: BillingExportRow[] = [
      { nr: 1, ziffer: "1", bezeichnung: "Beratung", faktor: 2.3, betrag: 10.5, quelleText: "A" },
    ];
    const t = billingRowsToTsv(rows);
    expect(t).toContain("Nr\tGOAE");
    expect(t).toContain("1\t1\t");
    expect(t).toContain("10,50");
  });
});

describe("splitPadDatIntoSegments", () => {
  it("splits PV880441 fixture as single segment", () => {
    const p = join(process.cwd(), "benchmarks/fixtures/pad-dat/PV880441-1.DAT");
    const raw = readFileSync(p, "utf8");
    const segs = splitPadDatIntoSegments(raw);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    expect(segs[0]?.some((l) => l.includes("PAD-DATEN"))).toBe(true);
    const round = joinPadDatSegments(segs);
    expect(round.replace(/\r\n/g, "\n").trimEnd()).toBe(raw.replace(/\r\n/g, "\n").trimEnd());
  });

  it("splits two PAD-DATEN blocks", () => {
    const raw = "111PAD-DATEN a\nline2\n222PAD-DATEN b\nline4\n";
    const segs = splitPadDatIntoSegments(raw);
    expect(segs.length).toBe(2);
    expect(segs[0]?.[0]).toContain("111PAD-DATEN");
    expect(segs[1]?.[0]).toContain("222PAD-DATEN");
  });
});
