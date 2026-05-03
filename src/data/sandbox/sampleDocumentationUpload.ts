import { BILLING_CASES } from "@/lib/sandbox/billingCases";
import type { EncounterType } from "@/lib/sandbox/types";

/** Meta für das Upload-Overlay (keine echte Datei — Inhalt aus Fall 0 der Sandbox-Billingcases). */
export const SANDBOX_SAMPLE_UPLOAD_FILE = {
  fileName: "Beispiel-Akte_Konjunktivitis.pdf",
  sizeLabel: "58 KB",
} as const;

export type SandboxSampleDocFormFill = {
  patientNameInput: string;
  date: string;
  providerNameInput: string;
  encounter: EncounterType;
  anamnesis: string;
  findings: string;
  diagnosisText: string;
  therapy: string;
};

/** Inhalt der „Beispieldatei“: erster Augenfall (Konjunktivitis-Demo). */
export function getSandboxSampleDocumentationFormFill(opts: {
  patientDisplayName: string;
  providerName: string;
  consultationDate?: string;
}): SandboxSampleDocFormFill {
  const d = BILLING_CASES[0]!.documentation;
  return {
    patientNameInput: opts.patientDisplayName,
    date: opts.consultationDate ?? new Date().toISOString().slice(0, 10),
    providerNameInput: opts.providerName,
    encounter: d.encounter_type,
    anamnesis: d.anamnesis,
    findings: d.findings,
    diagnosisText: d.diagnosis_text,
    therapy: d.therapy,
  };
}
