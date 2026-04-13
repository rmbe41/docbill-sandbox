import type { BillingExportRow } from "./billingExportRow";

/** Tab-separierte Textdatei (UTF-8) für Weiterverarbeitung / Archiv. */
export function billingRowsToTsv(rows: BillingExportRow[]): string {
  const header = ["Nr", "GOAE", "Bezeichnung", "Faktor", "Betrag_EUR", "Quelle", "Begruendung"].join("\t");
  const lines = rows.map((r) =>
    [
      r.nr,
      r.ziffer,
      escapeTsv(r.bezeichnung),
      String(r.faktor).replace(".", ","),
      r.betrag.toFixed(2).replace(".", ","),
      escapeTsv(r.quelleText ?? ""),
      escapeTsv(r.begruendung ?? ""),
    ].join("\t"),
  );
  return [header, ...lines].join("\n") + "\n";
}

function escapeTsv(s: string): string {
  const t = s.replace(/\r?\n/g, " ").replace(/\t/g, " ");
  if (/["\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

export function downloadTextFile(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
