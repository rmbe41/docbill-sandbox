import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from "react";
import { buildSandboxSeed } from "./seed";
import { BILLING_CASES, invoiceFromCase, pickBillingCaseIndex } from "./billingCases";
import { invoicePresentationPatch } from "./invoicePresentation";
import type { DocStatus, SandboxDocumentation, SandboxInvoice, SandboxPatient, SandboxSeedState } from "./types";

const STORAGE_KEY = "docbill-sandbox-v1";

export type SandboxStoreSnapshot = SandboxSeedState;

type Action =
  | { type: "RESET" }
  | { type: "HYDRATE"; payload: SandboxStoreSnapshot }
  | { type: "ADD_DOCUMENTATION"; doc: SandboxDocumentation }
  | { type: "UPSERT_PATIENT"; patient: SandboxPatient }
  | { type: "UPSERT_INVOICE"; invoice: SandboxInvoice }
  | { type: "PATCH_INVOICE"; id: string; patch: Partial<SandboxInvoice> }
  | { type: "PATCH_DOCUMENTATION"; id: string; patch: Partial<SandboxDocumentation> }
  | { type: "DELETE_INVOICE"; id: string };

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
      return { ...state, patients: [...rest, action.patient] };
    }
    case "UPSERT_INVOICE": {
      const rest = state.invoices.filter((i) => i.id !== action.invoice.id);
      return { ...state, invoices: [...rest, action.invoice] };
    }
    case "PATCH_INVOICE":
      return {
        ...state,
        invoices: state.invoices.map((i) => (i.id === action.id ? { ...i, ...action.patch } : i)),
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

function normalizeSandboxSnapshot(s: SandboxStoreSnapshot): SandboxStoreSnapshot {
  return {
    ...s,
    invoices: s.invoices.map((inv) => ({ ...inv, ...invoicePresentationPatch(inv as SandboxInvoice) })),
  };
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
  /** neue Patient:in oder bestehende überschreiben */
  upsertPatient: (p: SandboxPatient) => void;
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
      const caseId =
        opts?.caseId ??
        doc.case_id ??
        BILLING_CASES[pickBillingCaseIndex(doc.id, doc.patient_id, doc.diagnosis_text)]!.id;
      const c = BILLING_CASES.find((x) => x.id === caseId) ?? BILLING_CASES[0]!;
      const invId = `sb-inv-${Date.now()}`;
      const inv = invoiceFromCase(invId, docId, doc.patient_id, c, "proposed");
      dispatch({ type: "UPSERT_INVOICE", invoice: inv });
      dispatch({
        type: "PATCH_DOCUMENTATION",
        id: docId,
        patch: { status: "proposed" as DocStatus, case_id: c.id },
      });
      return inv;
    },
    [state.documentations, state.invoices],
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
