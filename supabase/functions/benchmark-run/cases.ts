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

// Compact starter set for in-app benchmark runs
export const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: "L1_single_standard_001",
    difficulty: "L1",
    tags: ["baseline"],
    inputDraft: {
      positions: [{ id: "p1", code: "5", factor: 2.3 }],
      context: { setting: "ambulant", specialty: "allgemein" },
    },
    gold: { expectedFindings: [] },
  },
  {
    id: "L1_high_factor_warn_002",
    difficulty: "L1",
    tags: ["faktor"],
    inputDraft: {
      positions: [{ id: "p1", code: "5", factor: 2.8 }],
      context: { setting: "ambulant", specialty: "allgemein" },
    },
    gold: { expectedFindings: [{ category: "faktor", severity: "warning", codeRefs: ["5"] }] },
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
    id: "L3_factor_time_combo_003",
    difficulty: "L3",
    tags: ["faktor", "zeit"],
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
      ],
    },
  },
];

