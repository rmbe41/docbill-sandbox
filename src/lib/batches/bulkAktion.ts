/** Spec 03 §5.1 — Bulk-Aktionen (Typ + Nutzlast) */
export interface BulkAktion {
  type: "accept_all" | "accept_selected" | "export_all" | "export_selected";
  batchId: string;
  rechnungIds: string[];
  optionen?: {
    exportFormat: "pdf" | "csv" | "pad";
    includeBegruendungen: boolean;
    includeHinweise: boolean;
  };
}
