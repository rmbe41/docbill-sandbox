/** Guided welcome flow: first turn collects text/uploads; next turn runs the pipeline. */
export type GuidedWorkflowKind =
  | "leistungen_abrechnen"
  | "rechnung_pruefen"
  | "frage_oeffnen";
