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

import { PKV_NAMES } from "@/data/sandbox/krankenkassenCatalog";

const PROVIDER_ID = "prov-1";

/**
 * Feste Rechnungs-Zielbrutto über die Sandbox-Fälle: linear zwischen SANDBOX_BILLING_INVOICE_MIN_EUR und SANDBOX_BILLING_INVOICE_MAX_EUR
 * (Konstanten in `./billingCases`, Index `sandboxBillingTargetEuroForCaseIndex(0 … SANDBOX_BILLING_CASE_COUNT − 1)`).
 * Positionsbetraege stammen nur aus dem KBV-EBM-Katalog (`src/data/ebm-catalog-2026-q2.json`) bzw. GOÄ `goae-catalog-v2`
 * mit Punktwert wie GOÄ-Regelengine (`sandboxTariff.ts`); GKV → EBM, PKV und Selbstzahler → GOÄ.
 */

/**
 * Kostenträger-Mix im Seed-Stammdatenpool (~30 Personen; Zyklus von 10 Indizes):
 *
 * | Anteil | Typ |
 * |--------|-----|
 * | 40 % | GKV |
 * | 50 % | PKV |
 * | 10 % | Selbstzahler |
 *
 * Details: `specs/09_SANDBOX_PROTOTYPE.md` → Abschnitt 12 (Seed-Zielgrößen).
 */
const SEED_GKV_PROVIDER_CYCLE: readonly string[] = [
  "DAK Gesundheit",
  "Techniker Krankenkasse (TK)",
  "BARMER",
  "mhplus Krankenkasse",
  "AOK Bayern",
  "IKK classic",
  "BIG direkt gesund",
  "SBK",
  "VIACTIV Krankenkasse",
];

/** i % 10: 0 = Selbst (10 %), 1–5 = PKV (50 %), 6–9 = GKV (40 %). */
function insuranceForIndex(i: number): Pick<SandboxPatient, "insurance_type" | "insurance_provider"> {
  const k = i % 10;
  if (k === 0) return { insurance_type: "self", insurance_provider: "Selbstzahler" };
  if (k >= 1 && k <= 5)
    return { insurance_type: "PKV", insurance_provider: PKV_NAMES[i % PKV_NAMES.length]! };
  const kk = SEED_GKV_PROVIDER_CYCLE[(i % SEED_GKV_PROVIDER_CYCLE.length)]!;
  return { insurance_type: "GKV", insurance_provider: kk };
}

/** Abwechselnd typisch weibliche / männliche Vornamen (Index i → Geschlecht in `buildSandboxSeedPatients`). */
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
  "Maximilian",
  "Lea",
  "Ben",
  "Lisa",
  "Tim",
  "Julia",
  "David",
  "Sarah",
  "Lukas",
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

const SEED_CITIES = [
  "Musterstadt",
  "Beispielhausen",
  "Demingen",
  "Altstadt",
  "Neustadt",
  "Linden",
  "Bergheim",
  "Seerhausen",
] as const;

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

/** Kleinschreibung + Umlaute für typische lokale E-Mail-Teile (ASCII). */
function emailLocalAscii(part: string): string {
  return part
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "");
}

const SEED_FREEMAIL_DOMAINS = [
  "web.de",
  "gmx.de",
  "posteo.de",
  "t-online.de",
  "icloud.com",
  "gmail.com",
  "yahoo.de",
  "outlook.de",
] as const;

/** Abwechselnd: vorname@post123.de, vorname+nachname@Freemail, vorname+Geburtsdatum@Freemail */
function sandboxSeedEmail(
  i: number,
  firstName: string,
  lastName: string,
  dobYmd: string,
): string {
  const first = emailLocalAscii(firstName);
  const last = emailLocalAscii(lastName);
  const ymd = dobYmd.replace(/-/g, "");
  const domain = SEED_FREEMAIL_DOMAINS[i % SEED_FREEMAIL_DOMAINS.length]!;
  const mode = i % 3;
  if (mode === 0) {
    const n = String(100 + ((i * 37) % 800));
    const providerStem = (["post", "mail", "freemail", "online", "netmail"] as const)[i % 5];
    return `${first}@${providerStem}${n}.de`;
  }
  if (mode === 1) {
    return `${first}+${last}@${domain}`;
  }
  return `${first}+${ymd}@${domain}`;
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

/** Kanonischer Stammdaten-Pool (~30 Personen); IDs stabil für LocalStorage-Reparatur. */
export function buildSandboxSeedPatients(): SandboxPatient[] {
  const patients: SandboxPatient[] = [];
  for (let i = 0; i < 30; i++) {
    const ins = insuranceForIndex(i);
    const id = `sb-pat-${String(i + 1).padStart(2, "0")}`;
    const plz = String(10000 + ((i * 137) % 89999)).padStart(5, "0");
    const memberYear = 2008 + (i % 15);
    const memberMonth = String((i % 11) + 1).padStart(2, "0");
    const ik =
      ins.insurance_type === "GKV"
        ? String(100000000 + (i * 791) % 899999999).padStart(9, "0")
        : undefined;
    const firstName = FIRST[i % FIRST.length]!;
    const lastName = LAST[i % LAST.length]!;
    const dob = `${1965 + (i % 45)}-${String((i % 11) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`;
    patients.push({
      id,
      name: `${lastName}, ${firstName}`,
      dob,
      insurance_number: `K${100000000 + i}`,
      insurance_status:
        ins.insurance_type === "GKV" ? "Mitglied" : ins.insurance_type === "PKV" ? "Versichert" : "Selbstzahlend",
      gender: i % 2 === 0 ? "weiblich" : "männlich",
      street: `Musterweg ${((i * 3) % 40) + 1}`,
      postal_code: plz,
      city: SEED_CITIES[i % SEED_CITIES.length]!,
      phone: `+49 170 ${String(1000000 + (i * 917) % 8999999)}`,
      phone_alt: `+49 89 ${String(2000000 + (i * 313) % 7999999)}`,
      email: sandboxSeedEmail(i, firstName, lastName, dob),
      consent_status: (["erteilt", "ausstehend", "fehlend"] as const)[i % 3],
      insurance_member_since: `${memberYear}-${memberMonth}-01`,
      insurance_ik: ik,
      ...ins,
    });
  }
  return patients;
}

export function buildSandboxSeed(): SandboxSeedState {
  const patients = buildSandboxSeedPatients();

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
      let inv = invoiceFromCase(invId, docId, patient.id, case_, st, patient.insurance_type);
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
