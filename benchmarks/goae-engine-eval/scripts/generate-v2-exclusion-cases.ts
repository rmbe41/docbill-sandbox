/**
 * Generiert Benchmark-Cases aus GOÄ-Katalog v2: code_conflict + targetCode.
 *
 * Gold-Policy (deterministisch):
 * - Paar (a,b) dedupliziert über kanonische Sortierung beider Codes (localeCompare de, numeric).
 * - Erwartetes Finding: ausschluss / error, codeRefs = sortierte Codes wie benchmark-run normalizeFindingKey (trim + toUpperCase + sort).
 * - Korrektur: es bleibt der lexikographisch kleinere Code (numeric-aware), der andere wird gestrichen.
 * - Betrag: round2(fee.points * PUNKTWERT * 2.3) — gleiche Konstante wie engine3 validate.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PUNKTWERT = 0.0582873;
const FACTOR = 2.3;

type GoaeFee = {
  points: number;
  simple: number;
  thresholdFactor: number;
  thresholdAmount: number;
  maxFactor: number;
  maxAmount: number;
};

type BillingExclusion = {
  type: string;
  targetCode?: string;
  targetRuleId?: string;
  reason: string;
};

type GoaeCode = {
  code: string;
  status: string;
  fee: GoaeFee;
  billingExclusions: BillingExclusion[];
};

type GoaeV2Root = {
  codes: GoaeCode[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function compareCode(a: string, b: string): number {
  return a.localeCompare(b, "de", { numeric: true, sensitivity: "variant" });
}

/** Wie normalizeFindingKey codeRefs im benchmark-run */
function sortedCodeRefsForFinding(a: string, b: string): string[] {
  return [a, b].map((c) => String(c).trim().toUpperCase()).sort((x, y) => x.localeCompare(y, "de", { numeric: true }));
}

function amountForCode(code: string, feeByCode: Map<string, GoaeFee>): number {
  const fee = feeByCode.get(code);
  if (!fee) throw new Error(`Missing fee for code ${code}`);
  return round2(fee.points * PUNKTWERT * FACTOR);
}

function safeIdPart(code: string): string {
  return String(code).trim().replace(/[^a-zA-Z0-9]+/g, "_");
}

function main() {
  const rootPath = resolve(process.cwd(), "src/data/goae-catalog-v2.json");
  const outBenchmarks = resolve(process.cwd(), "benchmarks/goae-engine-eval/cases/catalog-v2-exclusions.generated.json");

  const raw = readFileSync(rootPath, "utf-8");
  const root = JSON.parse(raw) as GoaeV2Root;
  const codes = root.codes ?? [];

  const feeByCode = new Map<string, GoaeFee>();
  const activeCodes = new Set<string>();
  for (const c of codes) {
    if (c.status !== "active") continue;
    const k = String(c.code).trim();
    activeCodes.add(k);
    feeByCode.set(k, c.fee);
  }

  const seenPairs = new Set<string>();

  type CaseRow = Record<string, unknown>;
  const cases: CaseRow[] = [];
  let seq = 0;

  for (const source of codes) {
    if (source.status !== "active") continue;
    const a = String(source.code).trim();
    for (const ex of source.billingExclusions ?? []) {
      if (ex.type !== "code_conflict" || !ex.targetCode) continue;
      const b = String(ex.targetCode).trim();
      if (!activeCodes.has(b)) continue;
      if (a === b) continue;
      const [c1, c2] = compareCode(a, b) <= 0 ? [a, b] : [b, a];
      const pairKey = `${c1}\x00${c2}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const kept = c1;
      const dropped = c2;
      const posKeptId = "p_kept";
      const posDropId = "p_drop";

      const refs = sortedCodeRefsForFinding(kept, dropped);
      const amt = amountForCode(kept, feeByCode);

      seq += 1;
      const id = `V2_EXC_${safeIdPart(kept)}_${safeIdPart(dropped)}_${String(seq).padStart(4, "0")}`;

      cases.push({
        id,
        difficulty: "L2",
        tags: ["ausschluss", "catalog-v2", "generated"],
        notes: ex.reason?.slice(0, 500),
        inputDraft: {
          positions: [
            { id: posKeptId, code: kept, factor: FACTOR },
            { id: posDropId, code: dropped, factor: FACTOR },
          ],
          context: { setting: "ambulant", specialty: "allgemein" },
        },
        gold: {
          expectedFindings: [{ category: "ausschluss", severity: "error", codeRefs: refs }],
          expectedCorrectedDraft: {
            positions: [{ id: posKeptId, code: kept, factor: FACTOR }],
            context: { setting: "ambulant", specialty: "allgemein" },
          },
          expectedAmounts: {
            positionAmounts: [{ id: posKeptId, amount: amt }],
            totalAmount: amt,
          },
          requiredEvidence: {
            mustHaveSourceRef: true,
            mustIncludeLegalRefs: ["Ausschlussziffern GOÄ-Katalog"],
          },
        },
      });
    }
  }

  if (cases.length < 100) {
    console.error(`Expected at least 100 cases, got ${cases.length}`);
    process.exit(1);
  }

  const json = JSON.stringify(cases, null, 2) + "\n";
  writeFileSync(outBenchmarks, json, "utf-8");
  console.log(`Wrote ${cases.length} cases to:\n  ${outBenchmarks}`);
  console.log("Hinweis: Vor supabase:deploy wird die Datei nach supabase/functions/benchmark-run/ kopiert (siehe package.json).");
}

main();
