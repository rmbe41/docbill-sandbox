import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type BenchmarkCase = {
  id: string;
  difficulty: "L1" | "L2" | "L3" | "L4";
  tags: string[];
  inputDraft: { positions: { id: string; code: string; factor: number }[] };
  gold: { expectedFindings: { category: string; severity: string; codeRefs: string[] }[] };
};

function readStarterCases(): BenchmarkCase[] {
  const path = resolve(process.cwd(), "benchmarks/goae-engine-eval/cases/starter-cases.json");
  return JSON.parse(readFileSync(path, "utf-8")) as BenchmarkCase[];
}

describe("GOAE benchmark starter cases", () => {
  it("enthaelt mehrere Faelle ueber alle Schwierigkeitgrade", () => {
    const cases = readStarterCases();
    expect(cases.length).toBeGreaterThanOrEqual(12);
    const diffs = new Set(cases.map((c) => c.difficulty));
    expect(diffs.has("L1")).toBe(true);
    expect(diffs.has("L2")).toBe(true);
    expect(diffs.has("L3")).toBe(true);
    expect(diffs.has("L4")).toBe(true);
  });

  it("hat eindeutige IDs und Minimal-Goldstandard pro Fall", () => {
    const cases = readStarterCases();
    const ids = new Set<string>();
    for (const testCase of cases) {
      expect(testCase.id.length).toBeGreaterThan(2);
      expect(ids.has(testCase.id)).toBe(false);
      ids.add(testCase.id);
      expect(testCase.inputDraft.positions.length).toBeGreaterThan(0);
      expect(Array.isArray(testCase.gold.expectedFindings)).toBe(true);
      for (const pos of testCase.inputDraft.positions) {
        expect(pos.id).toBeTruthy();
        expect(pos.code).toBeTruthy();
        expect(Number.isFinite(pos.factor)).toBe(true);
      }
    }
  });
});

