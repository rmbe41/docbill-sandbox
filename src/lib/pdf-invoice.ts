/**
 * Shared PDF invoice generation for GOÄ-Rechnungen.
 * Used by InvoiceResult (Rechnungsprüfung) and ServiceBillingResult (Leistungen abrechnen).
 * Footer: Spec 00 / 07 (einheitlicher KI-Hinweis).
 */
import { DOCBILL_KI_DISCLAIMER } from "@/lib/rechnung/docbillDisclaimer";

export interface PdfStammdaten {
  praxis?: { name?: string; adresse?: string; telefon?: string; email?: string; steuernummer?: string };
  patient?: { name?: string; adresse?: string; geburtsdatum?: string };
  bank?: { iban?: string; bic?: string; bankName?: string; kontoinhaber?: string };
  rechnungsnummer?: string;
  rechnungsdatum?: string;
}

export interface PdfPosition {
  nr: number;
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  begruendung?: string;
}

const MARGIN = 14;
const LINE_HEIGHT = 5;
const PAGE_HEIGHT = 297;
const FOOTER_MARGIN = 30;
/** Einheitliche Schriftgröße für die gesamte Rechnung (inkl. Kopf, Tabelle, Fuß). */
const FONT_PT = 10;
const GRAY_LINE = 200;
const GRAY_MUTED = 100;
const ZEBRA_GRAY = 246;

/** German number format: 2,3 instead of 2.3 */
function formatDeutsch(n: number, decimals: number): string {
  return n.toFixed(decimals).replace(".", ",");
}

/** Build filename: Rechnung-{Rechnungsnr}-{Datum}.pdf or Rechnung-{Datum}.pdf */
function buildFilename(stammdaten?: PdfStammdaten | null): string {
  const nr = stammdaten?.rechnungsnummer?.trim().replace(/[/\\?*:|"]/g, "-");
  const datum = stammdaten?.rechnungsdatum?.trim() ?? new Date().toISOString().slice(0, 10);
  if (nr) return `Rechnung-${nr}-${datum}.pdf`;
  return `Rechnung-${datum}.pdf`;
}

/** Check if we need a new page before adding content of given height */
function maybeNewPage(doc: import("jspdf").jsPDF, y: number, neededHeight: number): number {
  if (y + neededHeight > PAGE_HEIGHT - FOOTER_MARGIN) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function pageWidth(doc: import("jspdf").jsPDF): number {
  return doc.internal.pageSize.getWidth();
}

/** Draw page numbers on all pages (call after all content). */
function addPageFooters(doc: import("jspdf").jsPDF): void {
  const total = doc.getNumberOfPages();
  const w = pageWidth(doc);
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONT_PT);
    doc.setTextColor(GRAY_MUTED);
    doc.text(`Seite ${i} von ${total}`, w / 2, PAGE_HEIGHT - 12, { align: "center" });
    doc.setTextColor(0);
  }
}

export type GenerateInvoicePdfOptions = {
  /** Optional second-page audit trail (e.g. accepted/pending suggestion summary). */
  protocolLines?: string[];
};

export async function generateInvoicePdf(
  positions: PdfPosition[],
  sum: number,
  stammdaten?: PdfStammdaten | null,
  options?: GenerateInvoicePdfOptions | null,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  const pw = pageWidth(doc);
  const xRight = pw - MARGIN;
  let y = MARGIN;

  // —— Kopf: links Praxis (klein), rechts Titel + Rechnungsdaten ——
  const yStartHead = y;
  let yLeft = yStartHead;
  let yRightCol = yStartHead;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT_PT);
  doc.text("Rechnung", xRight, yRightCol, { align: "right" });
  yRightCol += LINE_HEIGHT;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT_PT);
  if (stammdaten?.rechnungsnummer) {
    doc.text(`Rechnungsnr.: ${stammdaten.rechnungsnummer}`, xRight, yRightCol, { align: "right" });
    yRightCol += LINE_HEIGHT;
  }
  if (stammdaten?.rechnungsdatum) {
    doc.text(`Datum: ${stammdaten.rechnungsdatum}`, xRight, yRightCol, { align: "right" });
    yRightCol += LINE_HEIGHT;
  }

  if (stammdaten?.praxis) {
    const p = stammdaten.praxis;
    const lines: string[] = [];
    if (p.name) lines.push(p.name);
    if (p.adresse) lines.push(p.adresse);
    if (p.telefon) lines.push(p.telefon);
    if (p.email) lines.push(p.email);
    if (p.steuernummer) lines.push(`Steuernr.: ${p.steuernummer}`);
    if (lines.length > 0) {
      doc.setFontSize(FONT_PT);
      doc.setTextColor(GRAY_MUTED);
      doc.setFont("helvetica", "normal");
      for (const line of lines) {
        doc.text(line, MARGIN, yLeft);
        yLeft += LINE_HEIGHT;
      }
      doc.setTextColor(0);
    }
  }

  y = Math.max(yLeft, yRightCol) + 6;
  doc.setDrawColor(GRAY_LINE);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, y, pw - MARGIN, y);
  y += 7;

  // —— Rechnungsempfänger ——
  if (stammdaten?.patient) {
    const p = stammdaten.patient;
    const lines: string[] = [];
    if (p.name) lines.push(p.name);
    if (p.adresse) lines.push(p.adresse);
    if (p.geburtsdatum) lines.push(`Geb.: ${p.geburtsdatum}`);
    if (lines.length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(FONT_PT);
      doc.text("Rechnungsempfänger", MARGIN, y);
      y += LINE_HEIGHT;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(FONT_PT);
      for (const line of lines) {
        y = maybeNewPage(doc, y, LINE_HEIGHT);
        doc.text(line, MARGIN, y);
        y += LINE_HEIGHT;
      }
      y += 5;
    }
  }

  // —— Tabellenspalten (mm) ——
  const hasBegruendung = positions.some((p) => p.begruendung);
  const xNr = MARGIN;
  const xGoae = MARGIN + 7;
  const xBez = MARGIN + 21;
  const xBetrag = xRight;
  const colBetragW = 24;
  const colFaktorW = 14;
  const xBetragLeft = xBetrag - colBetragW;
  const xFaktorLeft = xBetragLeft - colFaktorW;
  const colBegrW = hasBegruendung ? 36 : 0;
  const xBegr = hasBegruendung ? xFaktorLeft - colBegrW : xFaktorLeft;
  const bezWidthMm = xBegr - xBez - 2;
  const begrWidthMm = hasBegruendung ? colBegrW - 1 : 0;

  doc.setFontSize(FONT_PT);
  y = maybeNewPage(doc, y, 16);
  doc.setFont("helvetica", "bold");
  const headerY = y;
  doc.text("Nr", xNr, headerY);
  doc.text("GOÄ", xGoae, headerY);
  doc.text("Bezeichnung", xBez, headerY);
  if (hasBegruendung) doc.text("Begründung", xBegr, headerY);
  doc.text("Faktor", xFaktorLeft + colFaktorW - 1, headerY, { align: "right" });
  doc.text("Betrag", xBetrag, headerY, { align: "right" });
  doc.setFont("helvetica", "normal");
  y = headerY + 2;
  doc.setDrawColor(GRAY_LINE);
  doc.line(MARGIN, y, pw - MARGIN, y);
  y += 5;

  // —— Datenzeilen ——
  let rowIndex = 0;
  for (const p of positions) {
    const bezeichnungLines = doc.splitTextToSize(p.bezeichnung || "", Math.max(20, bezWidthMm));
    const begrRaw = hasBegruendung ? (p.begruendung?.trim() ? p.begruendung : "—") : "";
    const begruendungLines = hasBegruendung
      ? doc.splitTextToSize(begrRaw, Math.max(12, begrWidthMm))
      : [];
    const lineCount = Math.max(bezeichnungLines.length, begruendungLines.length, 1);
    const rowHeight = lineCount * LINE_HEIGHT + 3;

    y = maybeNewPage(doc, y, rowHeight);

    if (rowIndex % 2 === 1) {
      doc.setFillColor(ZEBRA_GRAY, ZEBRA_GRAY, ZEBRA_GRAY);
      doc.rect(MARGIN, y - 4, pw - 2 * MARGIN, rowHeight, "F");
      doc.setDrawColor(GRAY_LINE);
    }

    doc.setFontSize(FONT_PT);
    doc.text(String(p.nr), xNr, y);
    doc.text(p.ziffer, xGoae, y);

    for (let i = 0; i < bezeichnungLines.length; i++) {
      doc.text(bezeichnungLines[i], xBez, y + i * LINE_HEIGHT);
    }
    if (hasBegruendung) {
      for (let i = 0; i < begruendungLines.length; i++) {
        doc.text(begruendungLines[i], xBegr, y + i * LINE_HEIGHT);
      }
    }

    const faktorLabel = p.faktor === 0 && p.ziffer === "Sachk." ? "—" : `${formatDeutsch(p.faktor, 1)}×`;
    doc.text(faktorLabel, xFaktorLeft + colFaktorW - 1, y, { align: "right" });
    doc.text(`${formatDeutsch(p.betrag, 2)} €`, xBetrag, y, { align: "right" });

    y += rowHeight;
    rowIndex += 1;
  }

  y += 4;

  // —— Gesamtbetrag ——
  const sumBlockH = 14;
  y = maybeNewPage(doc, y, sumBlockH);
  const xSumLineStart = xBetragLeft - 35;
  doc.setDrawColor(GRAY_LINE);
  doc.line(xSumLineStart, y, xBetrag, y);
  y += 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT_PT);
  doc.text("Gesamtbetrag", xSumLineStart, y);
  doc.text(`${formatDeutsch(sum, 2)} €`, xBetrag, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  y += 12;

  // —— Änderungsprotokoll (optional) ——
  const protocolLines = options?.protocolLines?.filter((l) => l.trim().length > 0) ?? [];
  if (protocolLines.length > 0) {
    const titleBlock = LINE_HEIGHT * 2 + 4;
    y = maybeNewPage(doc, y, titleBlock + protocolLines.length * LINE_HEIGHT * 2);
    doc.setDrawColor(GRAY_LINE);
    doc.line(MARGIN, y, pw - MARGIN, y);
    y += LINE_HEIGHT + 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT_PT);
    doc.text("Änderungsprotokoll (DocBill-Vorschau)", MARGIN, y);
    y += LINE_HEIGHT + 3;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONT_PT - 0.5);
    for (const raw of protocolLines) {
      const wrapped = doc.splitTextToSize(raw, pw - 2 * MARGIN);
      for (const line of wrapped) {
        y = maybeNewPage(doc, y, LINE_HEIGHT + 2);
        doc.text(line, MARGIN, y);
        y += LINE_HEIGHT;
      }
      y += 2;
    }
    doc.setFontSize(FONT_PT);
    y += 8;
  }

  // —— Zahlungsinformation ——
  if (stammdaten?.bank) {
    const b = stammdaten.bank;
    const bankLines: string[] = [];
    if (b.iban) bankLines.push(`IBAN: ${b.iban}`);
    if (b.bic) bankLines.push(`BIC: ${b.bic}`);
    if (b.bankName) bankLines.push(b.bankName);
    if (b.kontoinhaber) bankLines.push(`Kontoinhaber: ${b.kontoinhaber}`);
    if (bankLines.length > 0) {
      y = maybeNewPage(doc, y, 8 + bankLines.length * LINE_HEIGHT);
      doc.setDrawColor(GRAY_LINE);
      doc.line(MARGIN, y, pw - MARGIN, y);
      y += 7;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(FONT_PT);
      doc.text("Zahlungsinformation", MARGIN, y);
      y += LINE_HEIGHT;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(FONT_PT);
      for (const line of bankLines) {
        y = maybeNewPage(doc, y, LINE_HEIGHT);
        doc.text(line, MARGIN, y);
        y += LINE_HEIGHT;
      }
    }
  }

  // —— Quellen ——
  const quellenText =
    "Gebührenordnung für Ärzte (GOÄ), Bundesrepublik Deutschland.";
  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT_PT);
  const quellenLines = doc.splitTextToSize(quellenText, pw - 2 * MARGIN);
  const quellenBlockH = LINE_HEIGHT + quellenLines.length * LINE_HEIGHT + 6;
  y = maybeNewPage(doc, y, quellenBlockH);
  doc.setDrawColor(GRAY_LINE);
  doc.line(MARGIN, y, pw - MARGIN, y);
  y += LINE_HEIGHT + 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT_PT);
  doc.setTextColor(0);
  doc.text("Quellen:", MARGIN, y);
  y += LINE_HEIGHT;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT_PT);
  for (const line of quellenLines) {
    y = maybeNewPage(doc, y, LINE_HEIGHT);
    doc.text(line, MARGIN, y);
    y += LINE_HEIGHT;
  }

  y += 4;
  const discLines = doc.splitTextToSize(DOCBILL_KI_DISCLAIMER, pw - 2 * MARGIN);
  const discH = LINE_HEIGHT * discLines.length + 6;
  y = maybeNewPage(doc, y, discH);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT_PT - 1);
  doc.setTextColor(GRAY_MUTED);
  for (const line of discLines) {
    y = maybeNewPage(doc, y, LINE_HEIGHT);
    doc.text(line, MARGIN, y);
    y += LINE_HEIGHT;
  }
  doc.setTextColor(0);
  doc.setFontSize(FONT_PT);

  addPageFooters(doc);
  doc.save(buildFilename(stammdaten));
}
