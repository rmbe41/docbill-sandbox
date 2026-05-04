import { SANDBOX_BILLING_CASE_COUNT } from "./billingCases";

/** Gesamt-Szenarien im Sandbox-Stammdatensatz (statisch). */
export const SANDBOX_SCENARIO_COUNT = 50;

/** Diese Szenarien sind nach Seed mit Rechnung/Doku im Flow sichtbar (Kanban etc.). */
export const SANDBOX_VISIBLE_SCENARIO_COUNT = 40;

/** Szenario-Indices 40…49 — vorbehalten für „Testdaten generieren“ (Patient + Kurator-Vorlage). */
export const SANDBOX_RESERVE_SCENARIO_START = SANDBOX_VISIBLE_SCENARIO_COUNT;

export type SandboxScenarioRow = {
  /** 0…49 → Patient `sb-pat-${idx + 1}` */
  patient_index: number;
  /** Index in `BILLING_CASES` — gemeinsame Quelle für Akteninhalt und Abrechnungsvorschlag */
  billing_case_index: number;
};

function buildDefaultScenarioRows(): SandboxScenarioRow[] {
  const rows: SandboxScenarioRow[] = [];
  for (let i = 0; i < SANDBOX_SCENARIO_COUNT; i++) {
    rows.push({
      patient_index: i % SANDBOX_SCENARIO_COUNT,
      billing_case_index: i % SANDBOX_BILLING_CASE_COUNT,
    });
  }
  return rows;
}

/**
 * Pro Zeile: welcher Patient zu welchem Billing-Fall gehört.
 * Hier können später Zuordnungen feingetuned werden (ohne UI zu ändern).
 */
export const SANDBOX_SCENARIO_ROWS: readonly SandboxScenarioRow[] = buildDefaultScenarioRows();

export function sandboxReserveScenarioIndices(): readonly number[] {
  const out: number[] = [];
  for (let i = SANDBOX_RESERVE_SCENARIO_START; i < SANDBOX_SCENARIO_COUNT; i++) out.push(i);
  return out;
}

/** Zufälliges Reserve-Szenario (Indices 40…49). */
export function randomReserveScenarioIndex(): number {
  const pool = sandboxReserveScenarioIndices();
  return pool[Math.floor(Math.random() * pool.length)]!;
}
