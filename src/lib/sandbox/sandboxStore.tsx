import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from "react";
import { buildSandboxSeed, buildSandboxSeedPatients } from "./seed";
import { BILLING_CASES, invoiceFromCase, pickBillingCaseIndex } from "./billingCases";
import { invoicePresentationPatch, recalcInvoiceTotal } from "./invoicePresentation";
import {
  billingBasisFromInsurance,
  type DocStatus,
  type SandboxDocumentation,
  type SandboxInvoice,
  type SandboxPatient,
  type SandboxProvider,
  type SandboxSeedState,
} from "./types";

const STORAGE_KEY = "docbill-sandbox-v1";

export type SandboxStoreSnapshot = SandboxSeedState;

type Action =
  | { type: "RESET" }
  | { type: "HYDRATE"; payload: SandboxStoreSnapshot }
  | { type: "ADD_DOCUMENTATION"; doc: SandboxDocumentation }
  | { type: "UPSERT_PATIENT"; patient: SandboxPatient }
  | { type: "UPSERT_PROVIDER"; provider: SandboxProvider }
  | { type: "UPSERT_INVOICE"; invoice: SandboxInvoice }
  | { type: "PATCH_INVOICE"; id: string; patch: Partial<SandboxInvoice> }
  | { type: "PATCH_DOCUMENTATION"; id: string; patch: Partial<SandboxDocumentation> }
  | { type: "DELETE_INVOICE"; id: string };

/** Eine Rechnung nutzt nur EBM (GKV) oder nur GOÄ (PKV/Selbstzahler); nicht kombinieren. */
function invoiceAlignedWithPatient(inv: SandboxInvoice, patient: SandboxPatient | undefined): SandboxInvoice {
  const billing_basis =
    patient != null ? billingBasisFromInsurance(patient.insurance_type) : (inv.billing_basis ?? "private");
  if (billing_basis === "statutory") {
    return { ...inv, billing_basis: "statutory", service_items_goae: [], service_items_ebm: inv.service_items_ebm };
  }
  return { ...inv, billing_basis: "private", service_items_ebm: [], service_items_goae: inv.service_items_goae };
}

function finalizeInvoice(
  inv: SandboxInvoice,
  patients: SandboxPatient[],
  documentations?: SandboxDocumentation[],
): SandboxInvoice {
  const p = patients.find((x) => x.id === inv.patient_id);
  let aligned = invoiceAlignedWithPatient(inv, p);

  /** Nach Kostenträger-Wechsel (z. B. PKV → GKV): vorher gefüllte Spur passt nicht — ohne Neuaufbau kann die Summe 0 € sein. */
  if (documentations != null && p != null && recalcInvoiceTotal(aligned) < 0.005) {
    const doc = documentations.find((d) => d.id === aligned.documentation_id);
    const cid = doc?.case_id;
    const c = cid != null ? BILLING_CASES.find((x) => x.id === cid) : undefined;
    if (c != null) {
      const rebuilt = invoiceFromCase(aligned.id, aligned.documentation_id, aligned.patient_id, c, aligned.status, p.insurance_type);
      aligned = invoiceAlignedWithPatient(
        {
          ...aligned,
          billing_basis: rebuilt.billing_basis,
          service_items_ebm: rebuilt.service_items_ebm,
          service_items_goae: rebuilt.service_items_goae,
        },
        p,
      );
    }
  }

  return { ...aligned, ...invoicePresentationPatch(aligned) };
}

/** Entfernt veraltete Sandbox-Bezeichner aus Stammdaten (z. B. alte LocalStorage-Snapshots). */
function migrateSandboxPatients(patients: SandboxPatient[]): SandboxPatient[] {
  return patients.map((p) => {
    if (/demo\s*pkv/i.test(p.insurance_provider.trim())) {
      return {
        ...p,
        insurance_type: "GKV",
        insurance_provider: "DAK Gesundheit",
        insurance_status: p.insurance_type === "PKV" ? "Mitglied" : p.insurance_status,
      };
    }
    return p;
  });
}

function isBlankSandboxField(v: string | undefined): boolean {
  return v == null || String(v).trim() === "" || String(v).trim() === "—";
}

/** Füllt fehlende Demo-Stammdaten aus dem Seed nach (gleiche `sb-pat-…`-IDs). */
function mergeSeedStammdatenForStoredPatients(patients: SandboxPatient[]): SandboxPatient[] {
  const canonical = buildSandboxSeedPatients();
  const byId = new Map(canonical.map((x) => [x.id, x]));
  return patients.map((p) => {
    const c = byId.get(p.id);
    if (!c) return p;
    const str = (a: string | undefined, b: string | undefined) => (!isBlankSandboxField(a) ? a! : b ?? a);
    return {
      ...p,
      gender: str(p.gender, c.gender),
      street: str(p.street, c.street),
      postal_code: str(p.postal_code, c.postal_code),
      city: str(p.city, c.city),
      phone: str(p.phone, c.phone),
      phone_alt: str(p.phone_alt, c.phone_alt),
      email: str(p.email, c.email),
      consent_status: p.consent_status ?? c.consent_status,
      insurance_status: str(p.insurance_status, c.insurance_status),
      insurance_member_since: str(p.insurance_member_since, c.insurance_member_since),
      insurance_ik:
        p.insurance_type === "GKV" && isBlankSandboxField(p.insurance_ik) ? c.insurance_ik : p.insurance_ik,
    };
  });
}

function normalizeSandboxSnapshot(s: SandboxStoreSnapshot): SandboxStoreSnapshot {
  const patients = mergeSeedStammdatenForStoredPatients(migrateSandboxPatients(s.patients));
  return {
    ...s,
    patients,
    invoices: s.invoices.map((inv) => {
      const raw = inv as SandboxInvoice & { diagnosis_codes?: unknown };
      const { diagnosis_codes: _legacy, ...rest } = raw;
      const billing_difficulty =
        rest.billing_difficulty ??
        (rest.confidence_tier === "low" ? "hard" : rest.confidence_tier === "medium" ? "medium" : "easy");
      const draft = { ...rest, billing_difficulty } as SandboxInvoice;
      return finalizeInvoice(draft, patients, s.documentations);
    }),
  };
}

function reducer(state: SandboxStoreSnapshot, action: Action): SandboxStoreSnapshot {
  switch (action.type) {
    case "RESET":
      return buildSandboxSeed();
    case "HYDRATE":
      return normalizeSandboxSnapshot(action.payload);
    case "ADD_DOCUMENTATION":
      return { ...state, documentations: [...state.documentations, action.doc] };
    case "UPSERT_PATIENT": {
      const rest = state.patients.filter((p) => p.id !== action.patient.id);
      const nextPatients = [...rest, action.patient];
      return {
        ...state,
        patients: nextPatients,
        invoices: state.invoices.map((i) =>
          i.patient_id === action.patient.id ? finalizeInvoice(i, nextPatients, state.documentations) : i,
        ),
      };
    }
    case "UPSERT_PROVIDER": {
      const rest = state.providers.filter((p) => p.id !== action.provider.id);
      return { ...state, providers: [...rest, action.provider] };
    }
    case "UPSERT_INVOICE": {
      const rest = state.invoices.filter((i) => i.id !== action.invoice.id);
      const inv = finalizeInvoice(action.invoice, state.patients, state.documentations);
      return { ...state, invoices: [...rest, inv] };
    }
    case "PATCH_INVOICE":
      return {
        ...state,
        invoices: state.invoices.map((i) =>
          i.id === action.id ? finalizeInvoice({ ...i, ...action.patch }, state.patients, state.documentations) : i,
        ),
      };
    case "PATCH_DOCUMENTATION":
      return {
        ...state,
        documentations: state.documentations.map((d) => (d.id === action.id ? { ...d, ...action.patch } : d)),
      };
    case "DELETE_INVOICE":
      return { ...state, invoices: state.invoices.filter((i) => i.id !== action.id) };
    default:
      return state;
  }
}
function loadPersisted(): SandboxStoreSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o?.patients || !o?.documentations || !o?.invoices) return null;
    return normalizeSandboxSnapshot(o as SandboxStoreSnapshot);
  } catch {
    return null;
  }
}

function persist(state: SandboxStoreSnapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

type Ctx = {
  state: SandboxStoreSnapshot;
  reset: () => void;
  /** neuen Patienten anlegen oder bestehenden Stammdatensatz überschreiben */
  upsertPatient: (p: SandboxPatient) => void;
  upsertProvider: (p: SandboxProvider) => void;
  addDocumentation: (d: SandboxDocumentation) => void;
  patchDocumentation: (id: string, patch: Partial<SandboxDocumentation>) => void;
  upsertInvoice: (inv: SandboxInvoice) => void;
  patchInvoice: (id: string, patch: Partial<SandboxInvoice>) => void;
  deleteInvoice: (id: string) => void;
  createInvoiceForDocumentation: (
    docId: string,
    opts?: { caseId?: string },
  ) => SandboxInvoice | null;
  rejectProposal: (invoiceId: string) => void;
};

const SandboxContext = createContext<Ctx | null>(null);

export function SandboxProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined as unknown as SandboxStoreSnapshot, () => {
    const persisted = loadPersisted();
    return persisted ?? buildSandboxSeed();
  });

  useEffect(() => {
    persist(state);
  }, [state]);

  const reset = useCallback(() => dispatch({ type: "RESET" }), []);
  const upsertPatient = useCallback((p: SandboxPatient) => dispatch({ type: "UPSERT_PATIENT", patient: p }), []);
  const upsertProvider = useCallback((p: SandboxProvider) => dispatch({ type: "UPSERT_PROVIDER", provider: p }), []);
  const addDocumentation = useCallback((d: SandboxDocumentation) => dispatch({ type: "ADD_DOCUMENTATION", doc: d }), []);
  const patchDocumentation = useCallback(
    (id: string, patch: Partial<SandboxDocumentation>) => dispatch({ type: "PATCH_DOCUMENTATION", id, patch }),
    [],
  );
  const upsertInvoice = useCallback((inv: SandboxInvoice) => dispatch({ type: "UPSERT_INVOICE", invoice: inv }), []);
  const patchInvoice = useCallback((id: string, patch: Partial<SandboxInvoice>) => dispatch({ type: "PATCH_INVOICE", id, patch }), []);
  const deleteInvoice = useCallback((id: string) => dispatch({ type: "DELETE_INVOICE", id }), []);

  const createInvoiceForDocumentation = useCallback(
    (docId: string, opts?: { caseId?: string }): SandboxInvoice | null => {
      const doc = state.documentations.find((d) => d.id === docId);
      if (!doc) return null;
      const existingProp = state.invoices.find((i) => i.documentation_id === docId && i.status === "proposed");
      if (existingProp) return existingProp;
      const patient = state.patients.find((p) => p.id === doc.patient_id);
      if (!patient) return null;
      const caseId =
        opts?.caseId ??
        doc.case_id ??
        BILLING_CASES[pickBillingCaseIndex(doc.id, doc.patient_id, doc.diagnosis_text)]!.id;
      const c = BILLING_CASES.find((x) => x.id === caseId) ?? BILLING_CASES[0]!;
      const invId = `sb-inv-${Date.now()}`;
      const inv = invoiceFromCase(invId, docId, doc.patient_id, c, "proposed", patient.insurance_type);
      dispatch({ type: "UPSERT_INVOICE", invoice: inv });
      dispatch({
        type: "PATCH_DOCUMENTATION",
        id: docId,
        patch: { status: "proposed" as DocStatus, case_id: c.id },
      });
      return inv;
    },
    [state.documentations, state.invoices, state.patients],
  );

  const rejectProposal = useCallback(
    (invoiceId: string) => {
      const inv = state.invoices.find((i) => i.id === invoiceId);
      if (!inv) return;
      dispatch({ type: "DELETE_INVOICE", id: invoiceId });
      dispatch({ type: "PATCH_DOCUMENTATION", id: inv.documentation_id, patch: { status: "draft", case_id: undefined } });
    },
    [state.invoices],
  );

  const value = useMemo(
    () => ({
      state,
      reset,
      upsertPatient,
      upsertProvider,
      addDocumentation,
      patchDocumentation,
      upsertInvoice,
      patchInvoice,
      deleteInvoice,
      createInvoiceForDocumentation,
      rejectProposal,
    }),
    [
      state,
      reset,
      upsertPatient,
      upsertProvider,
      addDocumentation,
      patchDocumentation,
      upsertInvoice,
      patchInvoice,
      deleteInvoice,
      createInvoiceForDocumentation,
      rejectProposal,
    ],
  );

  return <SandboxContext.Provider value={value}>{children}</SandboxContext.Provider>;
}

export function useSandbox() {
  const x = useContext(SandboxContext);
  if (!x) throw new Error("useSandbox nur innerhalb SandboxProvider");
  return x;
}
