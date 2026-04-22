import type { BatchKpi, BatchListeStatus } from "@/lib/batches/batchTypes";

/** Status-Spalte laut 03-Listen-Beispiel (Zahlen, „Hinweis“/„Hinweise“). */
export function formatStatusSpalte(liste: BatchListeStatus, kpi: BatchKpi | undefined): string {
  if (liste === "geprueft") return "✓ Geprüft";
  if (liste === "offen") return "○ Offen";
  if (liste === "fehler") {
    const n = kpi?.fehler ?? 1;
    return n === 1 ? "⚠ 1 Fehler" : `⚠ ${n} Fehler`;
  }
  if (liste === "mit_hinweisen") {
    const h = kpi?.hinweisGesamt ?? 0;
    if (h <= 0) return "⚠ mit Hinweisen";
    return h === 1 ? "⚠ 1 Hinweis" : `⚠ ${h} Hinweise`;
  }
  return liste;
}

/**
 * Spalte „Hinweise“ (rechts): 03 — z. B. „2 Optim.“, „1 Risiko“, „1 Fehler“, „—“
 */
export function formatHinweiseSpalte(kpi: BatchKpi | undefined, liste: BatchListeStatus): string {
  if (!kpi) return "—";
  if (liste === "geprueft") return "—";
  if (kpi.fehler > 0) return kpi.fehler === 1 ? "1 Fehler" : `${kpi.fehler} Fehler`;
  if (kpi.risiko > 0) return kpi.risiko === 1 ? "1 Risiko" : `${kpi.risiko} Risiko`;
  if (kpi.optimierung > 0) return kpi.optimierung === 1 ? "1 Optim." : `${kpi.optimierung} Optim.`;
  if (kpi.pruefen > 0) return kpi.pruefen === 1 ? "1 Prüfung" : `${kpi.pruefen} Prüfungen`;
  if (kpi.unvollstaendig > 0) return "Kombi";
  if (liste === "offen") return "—";
  return "—";
}
