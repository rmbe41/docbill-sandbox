/**
 * In-App-Benchmark — Starter-Fälle synchron mit
 * benchmarks/goae-engine-eval/cases/starter-cases.json (Runner nutzt nur gold.expectedFindings).
 * Zusätzlich: benchmarks/goae-engine-eval/scripts/generate-v2-exclusion-cases.ts → catalog-v2-exclusions.generated.json
 */
import catalogV2ExclusionCases from "./catalog-v2-exclusions.generated.json" with { type: "json" };

export type BenchmarkCase = {
  id: string;
  difficulty: "L1" | "L2" | "L3" | "L4";
  tags: string[];
  inputDraft: {
    positions: {
      id: string;
      code: string;
      factor: number;
      count?: number;
      durationMin?: number;
      amountClaimed?: number;
      notes?: string;
    }[];
    context: {
      setting?: "ambulant" | "stationaer" | "op" | "unknown";
      specialty?: string;
      patientAge?: number;
      treatmentDate?: string;
      caseId?: string;
    };
  };
  gold: {
    expectedFindings: {
      category: string;
      severity: "error" | "warning" | "info";
      codeRefs: string[];
    }[];
  };
};

const BENCHMARK_CASES_STARTER: BenchmarkCase[] = [
  {
    id: "L1_single_standard_001",
    difficulty: "L1",
    tags: ["baseline"],
    inputDraft: {
      positions: [{ id: "p1", code: "5", factor: 2.3, count: 1 }],
      context: { setting: "ambulant", specialty: "allgemein" },
    },
    gold: { expectedFindings: [] },
  },
  {
    id: "L1_high_factor_warn_002",
    difficulty: "L1",
    tags: ["faktor"],
    inputDraft: {
      positions: [{ id: "p1", code: "5", factor: 2.8, count: 1 }],
      context: { setting: "ambulant", specialty: "allgemein" },
    },
    gold: { expectedFindings: [{ category: "faktor", severity: "warning", codeRefs: ["5"] }] },
  },
  {
    id: "L1_over_max_error_003",
    difficulty: "L1",
    tags: ["faktor", "hard-error"],
    inputDraft: {
      positions: [{ id: "p1", code: "1", factor: 4.0, count: 1 }],
      context: { setting: "ambulant", specialty: "allgemein" },
    },
    gold: { expectedFindings: [{ category: "faktor", severity: "error", codeRefs: ["1"] }] },
  },
  {
    id: "L1_time_min_34_fail_004",
    difficulty: "L1",
    tags: ["zeit"],
    inputDraft: {
      positions: [{ id: "p1", code: "34", factor: 2.3, durationMin: 10 }],
      context: { setting: "ambulant", specialty: "psycho" },
    },
    gold: { expectedFindings: [{ category: "zeit", severity: "error", codeRefs: ["34"] }] },
  },
  {
    id: "L2_exclusion_1_3_001",
    difficulty: "L2",
    tags: ["ausschluss"],
    inputDraft: {
      positions: [
        { id: "p1", code: "1", factor: 2.3 },
        { id: "p2", code: "3", factor: 2.3 },
      ],
      context: { setting: "ambulant", specialty: "allgemein" },
    },
    gold: { expectedFindings: [{ category: "ausschluss", severity: "error", codeRefs: ["1", "3"] }] },
  },
  {
    id: "L2_exclusion_1201_1202_002",
    difficulty: "L2",
    tags: ["ausschluss", "augenheilkunde"],
    inputDraft: {
      positions: [
        { id: "p1", code: "1201", factor: 2.3 },
        { id: "p2", code: "1202", factor: 2.3 },
      ],
      context: { setting: "ambulant", specialty: "augenheilkunde" },
    },
    gold: { expectedFindings: [{ category: "ausschluss", severity: "error", codeRefs: ["1201", "1202"] }] },
  },
  {
    id: "L2_amount_mismatch_multi_003",
    difficulty: "L2",
    tags: ["rechenfehler"],
    inputDraft: {
      positions: [
        { id: "p1", code: "5", factor: 2.3, amountClaimed: 99.99 },
        { id: "p2", code: "1", factor: 2.3, amountClaimed: 12.22 },
      ],
      context: { setting: "ambulant", specialty: "allgemein" },
    },
    gold: {
      expectedFindings: [
        { category: "rechenfehler", severity: "warning", codeRefs: ["5"] },
        { category: "rechenfehler", severity: "warning", codeRefs: ["1"] },
      ],
    },
  },
  {
    id: "L2_time_bundle_unrealistic_004",
    difficulty: "L2",
    tags: ["zeit", "plausibilitaet"],
    inputDraft: {
      positions: [
        { id: "p1", code: "30", factor: 2.3, durationMin: 300 },
        { id: "p2", code: "31", factor: 2.3, durationMin: 240 },
        { id: "p3", code: "34", factor: 2.3, durationMin: 220 },
      ],
      context: { setting: "ambulant", specialty: "psycho" },
    },
    gold: { expectedFindings: [{ category: "zeit", severity: "warning", codeRefs: ["30", "31", "34"] }] },
  },
  {
    id: "L3_zielleistung_bloodstopping_001",
    difficulty: "L3",
    tags: ["zielleistung", "op"],
    inputDraft: {
      positions: [{ id: "p1", code: "253", factor: 2.3, notes: "Blutstillung als Teilschritt der OP" }],
      context: { setting: "op", specialty: "chirurgie" },
    },
    gold: { expectedFindings: [{ category: "zielleistung", severity: "error", codeRefs: ["253"] }] },
  },
  {
    id: "L3_conflict_chain_002",
    difficulty: "L3",
    tags: ["ausschluss", "multi"],
    inputDraft: {
      positions: [
        { id: "p1", code: "1", factor: 2.3 },
        { id: "p2", code: "3", factor: 2.3 },
        { id: "p3", code: "1201", factor: 2.3 },
        { id: "p4", code: "1202", factor: 2.3 },
      ],
      context: { setting: "ambulant", specialty: "augenheilkunde" },
    },
    gold: {
      expectedFindings: [
        { category: "ausschluss", severity: "error", codeRefs: ["1", "3"] },
        { category: "ausschluss", severity: "error", codeRefs: ["1201", "1202"] },
      ],
    },
  },
  {
    id: "L3_factor_time_combo_003",
    difficulty: "L3",
    tags: ["faktor", "zeit", "mixed"],
    inputDraft: {
      positions: [
        { id: "p1", code: "34", factor: 2.8, durationMin: 12 },
        { id: "p2", code: "1", factor: 4.0, durationMin: 5 },
      ],
      context: { setting: "ambulant", specialty: "psycho" },
    },
    gold: {
      expectedFindings: [
        { category: "zeit", severity: "error", codeRefs: ["34"] },
        { category: "faktor", severity: "warning", codeRefs: ["34"] },
        { category: "faktor", severity: "error", codeRefs: ["1"] },
      ],
    },
  },
  {
    id: "L3_stationary_time_overload_004",
    difficulty: "L3",
    tags: ["zeit", "stationaer"],
    inputDraft: {
      positions: [
        { id: "p1", code: "30", factor: 2.3, durationMin: 520 },
        { id: "p2", code: "31", factor: 2.3, durationMin: 470 },
      ],
      context: { setting: "stationaer", specialty: "psychiatrie" },
    },
    gold: { expectedFindings: [{ category: "zeit", severity: "warning", codeRefs: ["30", "31"] }] },
  },
  {
    id: "L4_ambiguous_analog_001",
    difficulty: "L4",
    tags: ["analog", "manual-review"],
    inputDraft: {
      positions: [{ id: "p1", code: "78", factor: 2.3, notes: "individueller Therapieplan ausserhalb Onkologie" }],
      context: { setting: "stationaer", specialty: "innere" },
    },
    gold: { expectedFindings: [{ category: "analog", severity: "warning", codeRefs: ["78"] }] },
  },
  {
    id: "L4_multiconflict_priority_002",
    difficulty: "L4",
    tags: ["priority", "ausschluss", "faktor", "zeit"],
    inputDraft: {
      positions: [
        { id: "p1", code: "1", factor: 4.2 },
        { id: "p2", code: "3", factor: 2.3 },
        { id: "p3", code: "34", factor: 2.6, durationMin: 10 },
      ],
      context: { setting: "ambulant", specialty: "allgemein" },
    },
    gold: {
      expectedFindings: [
        { category: "ausschluss", severity: "error", codeRefs: ["1", "3"] },
        { category: "faktor", severity: "error", codeRefs: ["1"] },
        { category: "zeit", severity: "error", codeRefs: ["34"] },
        { category: "faktor", severity: "warning", codeRefs: ["34"] },
      ],
    },
  },
  {
    id: "L4_sparse_docs_high_factor_003",
    difficulty: "L4",
    tags: ["evidence", "faktor"],
    inputDraft: {
      positions: [
        { id: "p1", code: "5", factor: 2.9, notes: "" },
        { id: "p2", code: "34", factor: 2.7, durationMin: 22, notes: "" },
      ],
      context: { setting: "unknown", specialty: "unknown" },
    },
    gold: {
      expectedFindings: [
        { category: "faktor", severity: "warning", codeRefs: ["5"] },
        { category: "faktor", severity: "warning", codeRefs: ["34"] },
        { category: "kontext", severity: "warning", codeRefs: ["5", "34"] },
      ],
    },
  },
  {
    id: "L4_full_stress_004",
    difficulty: "L4",
    tags: ["stress", "mixed"],
    inputDraft: {
      positions: [
        { id: "p1", code: "1", factor: 2.3 },
        { id: "p2", code: "3", factor: 2.3 },
        { id: "p3", code: "1201", factor: 2.3 },
        { id: "p4", code: "1202", factor: 2.3 },
        { id: "p5", code: "34", factor: 2.8, durationMin: 12 },
        { id: "p6", code: "253", factor: 2.3, notes: "Blutstillung als Teilschritt der OP" },
      ],
      context: { setting: "op", specialty: "augenheilkunde" },
    },
    gold: {
      expectedFindings: [
        { category: "ausschluss", severity: "error", codeRefs: ["1", "3"] },
        { category: "ausschluss", severity: "error", codeRefs: ["1201", "1202"] },
        { category: "zeit", severity: "error", codeRefs: ["34"] },
        { category: "faktor", severity: "warning", codeRefs: ["34"] },
        { category: "zielleistung", severity: "error", codeRefs: ["253"] },
      ],
    },
  },
];

const CATALOG_V2_GENERATED = catalogV2ExclusionCases as unknown as BenchmarkCase[];

/** `BENCHMARK_STARTER_ONLY=true`: nur Starter-Fälle (Smoke-Test). Standard: Starter + Katalog-v2-Ausschlüsse. */
const starterOnly = Deno.env.get("BENCHMARK_STARTER_ONLY") === "true";

export const BENCHMARK_CASES: BenchmarkCase[] = starterOnly
  ? BENCHMARK_CASES_STARTER
  : [...BENCHMARK_CASES_STARTER, ...CATALOG_V2_GENERATED];
