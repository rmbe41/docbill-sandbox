import { BILLING_CASES, invoiceFromCase } from "./billingCases";
import type {
  DocStatus,
  InvoiceStatus,
  SandboxDocumentation,
  SandboxInvoice,
  SandboxPatient,
  SandboxSeedState,
  TimelineEntry,
} from "./types";

const PROVIDER_ID = "prov-1";

const GKV_NAMES = [
  "BARMER",
  "Techniker Krankenkasse (TK)",
  "AOK Bayern",
  "DAK-Gesundheit",
  "ikk classic",
  "mhplus Betriebskrankenkasse",
  "BIG direkt gesund",
  "Audi BKK",
  "Handelskrankenkasse (hkk)",
  "Knappschaft",
];

const PKV_NAMES = [
  "Allianz Private Krankenversicherung",
  "AXA Krankenversicherung",
  "Debeka Krankenversicherungsverein",
  "Dialog Krankenversicherung",
  "Generali Gesundheit",
  "Hallesche Krankenversicherung",
  "R+V Krankenversicherung",
  "Signal Iduna Krankenversicherung",
  "UKV Union Krankenversicherung",
  "WWK Krankenversicherung",
  "Barmenia Krankenversicherung",
  "INTER Krankenversicherung",
];

/** Pro 10 Patienten: 1 Selbst, 4 PKV, 5 GKV — skaliert gleichmäßig mit Listenlänge */
function insuranceForIndex(i: number): Pick<SandboxPatient, "insurance_type" | "insurance_provider"> {
  const k = i % 10;
  if (k === 0) return { insurance_type: "self", insurance_provider: "Selbstzahler" };
  if (k >= 1 && k <= 4)
    return { insurance_type: "PKV", insurance_provider: PKV_NAMES[i % PKV_NAMES.length]! };
  const kk = GKV_NAMES[i % GKV_NAMES.length]!;
  return { insurance_type: "GKV", insurance_provider: kk };
}

const FIRST = [
  "Maria",
  "Thomas",
  "Anna",
  "Jonas",
  "Laura",
  "Felix",
  "Sophie",
  "Leon",
  "Emilia",
  "Paul",
  "Hannah",
  "Max",
  "Lea",
  "Ben",
  "Lisa",
  "Tim",
  "Julia",
  "David",
  "Sarah",
  "Jan",
  "Nina",
  "Simon",
  "Katharina",
  "Michael",
  "Elena",
  "Florian",
  "Theresa",
  "Niklas",
  "Vanessa",
  "Patrick",
];

const LAST = [
  "Müller",
  "Schmidt",
  "Schneider",
  "Weber",
  "Fischer",
  "Wagner",
  "Becker",
  "Hoffmann",
  "Schulz",
  "Koch",
  "Richter",
  "Klein",
  "Wolf",
  "Schröder",
  "Neumann",
  "Schwarz",
  "Zimmermann",
  "Braun",
  "Krüger",
  "Hofmann",
  "Lange",
  "Schmitt",
  "Werner",
  "Krause",
  "Meier",
  "Lehmann",
  "Schmid",
  "Schulze",
  "Maier",
  "Köhler",
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function statusForInvoiceIndex(i: number): InvoiceStatus {
  if (i < 8) return "proposed";
  if (i < 13) return "approved";
  if (i < 33) return "sent";
  if (i < 42) return "paid";
  if (i < 45) return "appealed";
  return "denied";
}

function docStatusForInvoice(st: InvoiceStatus): DocStatus {
  if (st === "proposed") return "proposed";
  return "invoiced";
}

function enrichTimeline(st: InvoiceStatus, base: TimelineEntry[]): TimelineEntry[] {
  const t = [...base];
  const ts = (offset: number) => new Date(Date.now() - offset * 3600_000).toISOString();
  if (st === "approved" || st === "sent" || st === "paid" || st === "denied" || st === "appealed") {
    t.push({ ts: ts(48), event: "Freigegeben", actor: "Dr. A. Linsen" });
  }
  if (st === "sent" || st === "paid" || st === "denied" || st === "appealed") {
    t.push({ ts: ts(36), event: "Versendet", actor: "System" });
  }
  if (st === "paid") {
    t.push({ ts: ts(12), event: "Zahlung eingegangen", actor: "Kostenträger" });
  }
  if (st === "appealed") {
    t.push({ ts: ts(12), event: "Rückmeldung — Klärung erforderlich", actor: "Kostenträger" });
  }
  if (st === "denied") {
    t.push({ ts: ts(12), event: "Abgelehnt", actor: "Kostenträger" });
  }
  return t;
}

export function buildSandboxSeed(): SandboxSeedState {
  const patients: SandboxPatient[] = [];
  for (let i = 0; i < 30; i++) {
    const ins = insuranceForIndex(i);
    const id = `sb-pat-${String(i + 1).padStart(2, "0")}`;
    patients.push({
      id,
      name: `${LAST[i % LAST.length]!}, ${FIRST[i % FIRST.length]!}`,
      dob: `${1965 + (i % 45)}-${String((i % 11) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
      insurance_number: `K${100000000 + i}`,
      insurance_status: ins.insurance_type === "GKV" ? "Mitglied" : ins.insurance_type === "PKV" ? "Versichert" : "—",
      ...ins,
    });
  }

  const documentations: SandboxDocumentation[] = [];
  const invoices: SandboxInvoice[] = [];

  const NUM_INVOICED_DOCS = 48;
  const NUM_DRAFT_ONLY = 10;
  const TOTAL_DOCS = NUM_INVOICED_DOCS + NUM_DRAFT_ONLY;

  for (let i = 0; i < TOTAL_DOCS; i++) {
    const docId = `sb-doc-${String(i + 1).padStart(3, "0")}`;
    const patient = patients[i % patients.length]!;
    const case_ = BILLING_CASES[i % BILLING_CASES.length]!;
    const days = (i * 17 + 3) % 90;
    const isDraft = i >= NUM_INVOICED_DOCS;

    const doc: SandboxDocumentation = {
      id: docId,
      patient_id: patient.id,
      date: isoDaysAgo(days),
      provider_id: PROVIDER_ID,
      encounter_type: case_.documentation.encounter_type,
      anamnesis: case_.documentation.anamnesis,
      findings: case_.documentation.findings,
      diagnosis_text: case_.documentation.diagnosis_text,
      therapy: case_.documentation.therapy,
      status: isDraft ? "draft" : docStatusForInvoice(statusForInvoiceIndex(i)),
      case_id: case_.id,
      created_at: new Date(Date.now() - days * 86400000).toISOString(),
    };
    documentations.push(doc);

    if (!isDraft) {
      const st = statusForInvoiceIndex(i);
      const invId = `sb-inv-${String(i + 1).padStart(3, "0")}`;
      let inv = invoiceFromCase(invId, docId, patient.id, case_, st);
      inv = { ...inv, timeline: enrichTimeline(st, inv.timeline) };
      invoices.push(inv);
    }
  }

  return {
    practice_line: "Dr. A. Linsen · Augenheilkunde · AugenCentrum Musterstadt",
    providers: [{ id: PROVIDER_ID, name: "Dr. A. Linsen" }],
    patients,
    documentations,
    invoices,
  };
}
