import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

type BenchmarkCase = {
  id: string;
  difficulty: "L1" | "L2" | "L3" | "L4";
  tags: string[];
  inputDraft: { positions: { id: string; code: string; factor: number }[] };
  gold: { expectedFindings: { category: string; severity: string; codeRefs: string[] }[] };
};

const caseListSchema = JSON.parse(
  readFileSync(resolve(process.cwd(), "benchmarks/goae-engine-eval/schema/case.schema.json"), "utf-8"),
) as object;

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateCaseList = ajv.compile(caseListSchema);

function readStarterCases(): BenchmarkCase[] {
  const path = resolve(process.cwd(), "benchmarks/goae-engine-eval/cases/starter-cases.json");
  return JSON.parse(readFileSync(path, "utf-8")) as BenchmarkCase[];
}

function readCatalogV2GeneratedCases(): BenchmarkCase[] {
  const path = resolve(process.cwd(), "benchmarks/goae-engine-eval/cases/catalog-v2-exclusions.generated.json");
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

  it("validiert starter-cases.json gegen case.schema.json", () => {
    const cases = readStarterCases();
    const ok = validateCaseList(cases);
    expect(ok, ajv.errorsText(validateCaseList.errors)).toBe(true);
  });
});

describe("GOAE benchmark catalog-v2 generated exclusions", () => {
  it("hat mindestens 100 Faelle und validiert gegen case.schema.json", () => {
    const cases = readCatalogV2GeneratedCases();
    expect(cases.length).toBeGreaterThanOrEqual(100);
    const ok = validateCaseList(cases);
    expect(ok, ajv.errorsText(validateCaseList.errors)).toBe(true);
  });

  it("hat eindeutige IDs unter Starter + generiert", () => {
    const starter = readStarterCases();
    const generated = readCatalogV2GeneratedCases();
    const ids = new Set<string>();
    for (const c of [...starter, ...generated]) {
      expect(ids.has(c.id), `duplicate id: ${c.id}`).toBe(false);
      ids.add(c.id);
    }
  });
});
