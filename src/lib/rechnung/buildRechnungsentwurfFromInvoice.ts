import type { InvoiceResultData } from "@/components/InvoiceResult";
import type { Regelwerk } from "@/lib/analyse/types";
import type { KennzeichnungStufe } from "@/lib/analyse/types";
import type { Rechnungsentwurf, RechnungsHinweis, RechnungsPosition } from "./rechnungsentwurfTypes";

/**
 * Eine exportierte Vorschauzeile aus InvoiceResult (↔ `exportPositions` / PreviewRow, relevante Felder).
 */
export type InvoiceEntwurfRowInput = {
  nr: number;
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  begruendung?: string;
  sourcePosNr?: number;
  pruefStatus?: "korrekt" | "warnung" | "fehler";
  ausschlussVorschlagSeite?: boolean;
  sourceOptSuggestionId?: string;
  isPendingOpt?: boolean;
};

function kennFromRow(row: InvoiceEntwurfRowInput): KennzeichnungStufe {
  if (row.sourceOptSuggestionId != null || row.isPendingOpt) return "OPTIMIERUNG";
  if (row.ausschlussVorschlagSeite) return "PRÜFEN";
  if (row.pruefStatus === "fehler") return "FEHLER";
  if (row.pruefStatus === "warnung") return "PRÜFEN";
  return "SICHER";
}

function isAnalogForSource(data: InvoiceResultData, sourcePosNr: number | undefined): boolean {
  if (sourcePosNr == null) return false;
  const pos = data.positionen.find((p) => p.nr === sourcePosNr);
  return pos?.pruefungen.some((p) => p.typ === "analog") ?? false;
}

function hinweiseFromInvoice(
  data: InvoiceResultData,
  exportRows: InvoiceEntwurfRowInput[],
): RechnungsHinweis[] {
  const out: RechnungsHinweis[] = [];
  for (let i = 0; i < exportRows.length; i++) {
    const row = exportRows[i]!;
    const sp = row.sourcePosNr;
    if (sp == null) continue;
    const pos = data.positionen.find((p) => p.nr === sp);
    if (!pos) continue;
    for (const pr of pos.pruefungen) {
      const t = (pr.nachricht ?? "").trim();
      if (!t) continue;
      const typ: RechnungsHinweis["typ"] =
        pr.schwere === "fehler" ? "warnung" : pr.schwere === "warnung" ? "info" : "info";
      out.push({ positionIndex: i, typ, text: t });
    }
  }
  return out;
}

/**
 * Ermittelt `pseudonymId` aus Rechnungsnummer ohne Klarnamen (Spec-04-`PseudonymizedPatient`).
 */
export function pseudonymIdFuerEinzelfall(rechnungsnummer: string | undefined | null): string {
  const n = (rechnungsnummer ?? "").trim();
  if (n) return `rechnung-${n.replace(/[/\\?*:|"]/g, "-")}`;
  return "einzelrechnung";
}

/**
 * Baut `Rechnungsentwurf` aus geprüfter Einzelrechnung (Modus A) — dieselbe Domäne wie Batch-Export.
 * `exportRows` = aktuelle Vorschau (`exportPositions` in InvoiceResult) inkl. angenommener Vorschläge.
 */
export function buildRechnungsentwurfFromInvoice(input: {
  data: InvoiceResultData;
  exportRows: InvoiceEntwurfRowInput[];
  gesamtbetrag: number;
  /** Default: aus Rechnungsnummer oder `einzelrechnung`. */
  pseudonymId?: string;
  entwurfId?: string;
  status?: "fertig" | "exportiert";
  erstelltAm?: string;
  regelwerk?: Regelwerk;
}): Rechnungsentwurf {
  const {
    data,
    exportRows,
    gesamtbetrag,
    entwurfId = `invoice-${Date.now()}`,
    status = "fertig",
    erstelltAm = new Date().toISOString(),
    regelwerk = "GOAE",
  } = input;
  const pseudonymId = input.pseudonymId ?? pseudonymIdFuerEinzelfall(data.stammdaten?.rechnungsnummer);

  const positionen: RechnungsPosition[] = exportRows.map((row) => {
    const anzahl = 1;
    const g = row.betrag;
    const einzel = anzahl > 0 ? Math.round((g / anzahl) * 100) / 100 : 0;
    const pos: RechnungsPosition = {
      ziffer: row.ziffer,
      beschreibung: (row.bezeichnung ?? "—").trim() || "—",
      anzahl,
      einzelbetrag: einzel,
      gesamtbetrag: g,
      isAnalog: isAnalogForSource(data, row.sourcePosNr),
      kennzeichnung: kennFromRow(row),
    };
    if (regelwerk === "GOAE") pos.faktor = row.faktor;
    if (row.begruendung?.trim()) pos.begruendung = row.begruendung.trim();
    return pos;
  });

  return {
    id: entwurfId,
    patient: { pseudonymId },
    regelwerk,
    positionen,
    gesamtbetrag: Math.round(gesamtbetrag * 100) / 100,
    status,
    erstelltAm,
    hinweise: hinweiseFromInvoice(data, exportRows),
    einwilligungsHinweise: [],
  };
}
