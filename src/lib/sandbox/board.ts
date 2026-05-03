import type { SandboxInvoice } from "./types";

/** Pipeline-Spalten im Board (Claims-Phasen); `InvoiceStatus` bleibt die Datenquelle. */
export type BoardColumnId = "pre_visit" | "submitted" | "followup" | "paid";

export function invoiceBoardColumn(inv: SandboxInvoice): BoardColumnId {
  const s = inv.status;
  if (s === "proposed" || s === "approved") return "pre_visit";
  if (s === "sent") return "submitted";
  if (s === "denied" || s === "appealed") return "followup";
  return "paid";
}

/** Nur für Spalte Nachfassung (`denied` / `appealed`). Bezahlt hat eigene Spalte. */
export function followupSubLabel(inv: SandboxInvoice): "denied" | "appealed" {
  return inv.status === "denied" ? "denied" : "appealed";
}

/** Auszahlungs-/Endstatus unter Bezahlt bzw. Legacy-Anzeige. */
export function terminalSubLabel(inv: SandboxInvoice): "paid" | "denied" | "appealed" {
  if (inv.status === "paid") return "paid";
  if (inv.status === "denied") return "denied";
  return "appealed";
}
