/**
 * Shared PDF invoice generation for GOÄ-Rechnungen.
 * Used by InvoiceResult (Rechnungsprüfung) and ServiceBillingResult (Leistungen abrechnen).
 */

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
const FOOTER_MARGIN = 25;
const BEGRUENDUNG_MAX_WIDTH = 25;

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

/** Split text into lines that fit within maxWidth (approx chars) */
function wrapText(text: string, maxChars: number): string[] {
  if (!text || text.length <= maxChars) return text ? [text] : [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = w.length > maxChars ? w.slice(0, maxChars) : w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function generateInvoicePdf(
  positions: PdfPosition[],
  sum: number,
  stammdaten?: PdfStammdaten | null,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  let y = MARGIN;

  // 1. Praxis
  if (stammdaten?.praxis) {
    const p = stammdaten.praxis;
    const lines: string[] = [];
    if (p.name) lines.push(p.name);
    if (p.adresse) lines.push(p.adresse);
    if (p.telefon) lines.push(p.telefon);
    if (p.email) lines.push(p.email);
    if (p.steuernummer) lines.push(`Steuernr.: ${p.steuernummer}`);
    if (lines.length > 0) {
      doc.setFontSize(10);
      for (const line of lines) {
        y = maybeNewPage(doc, y, LINE_HEIGHT);
        doc.text(line, MARGIN, y);
        y += LINE_HEIGHT;
      }
      y += 4;
    }
  }

  // 2. Patient
  if (stammdaten?.patient) {
    const p = stammdaten.patient;
    const lines: string[] = [];
    if (p.name) lines.push(p.name);
    if (p.adresse) lines.push(p.adresse);
    if (p.geburtsdatum) lines.push(`Geb.: ${p.geburtsdatum}`);
    if (lines.length > 0) {
      doc.setFontSize(10);
      for (const line of lines) {
        y = maybeNewPage(doc, y, LINE_HEIGHT);
        doc.text(line, MARGIN, y);
        y += LINE_HEIGHT;
      }
      y += 4;
    }
  }

  // 3. Rechnungsnummer, Rechnungsdatum
  if (stammdaten?.rechnungsnummer || stammdaten?.rechnungsdatum) {
    doc.setFontSize(10);
    y = maybeNewPage(doc, y, LINE_HEIGHT + 4);
    const parts: string[] = [];
    if (stammdaten.rechnungsnummer) parts.push(`Rechnungsnr.: ${stammdaten.rechnungsnummer}`);
    if (stammdaten.rechnungsdatum) parts.push(`Datum: ${stammdaten.rechnungsdatum}`);
    doc.text(parts.join("  |  "), MARGIN, y);
    y += 8;
  }

  // 4. Table header
  const hasBegruendung = positions.some((p) => p.begruendung);
  doc.setFontSize(10);
  y = maybeNewPage(doc, y, 20);
  doc.text("Nr", MARGIN, y);
  doc.text("GOÄ", MARGIN + 12, y);
  doc.text("Bezeichnung", MARGIN + 28, y);
  doc.text("Faktor", MARGIN + 130, y);
  doc.text("Betrag", MARGIN + 155, y);
  if (hasBegruendung) doc.text("Begründung", MARGIN + 175, y);
  y += 6;

  // 5. Table rows with text wrapping and page breaks
  for (const p of positions) {
    const bezeichnungLines = wrapText(p.bezeichnung, 45);
    const begruendungText = p.begruendung ?? "—";
    const begruendungLines = wrapText(begruendungText, BEGRUENDUNG_MAX_WIDTH);
    const rowHeight = Math.max(bezeichnungLines.length, begruendungLines.length) * LINE_HEIGHT + 2;

    y = maybeNewPage(doc, y, rowHeight);

    doc.text(String(p.nr), MARGIN, y);
    doc.text(p.ziffer, MARGIN + 12, y);
    // Bezeichnung: wrap if longer than ~45 chars
    if (bezeichnungLines.length === 1) {
      doc.text(bezeichnungLines[0].length > 45 ? bezeichnungLines[0].slice(0, 44) + "…" : bezeichnungLines[0], MARGIN + 28, y);
    } else {
      for (let i = 0; i < bezeichnungLines.length; i++) {
        doc.text(bezeichnungLines[i].slice(0, 50) + (bezeichnungLines[i].length > 50 ? "…" : ""), MARGIN + 28, y + i * LINE_HEIGHT);
      }
    }
    doc.text(`${formatDeutsch(p.faktor, 1)}×`, MARGIN + 130, y);
    doc.text(`${formatDeutsch(p.betrag, 2)} €`, MARGIN + 155, y);
    if (hasBegruendung) {
      doc.text(begruendungLines[0].slice(0, 25), MARGIN + 175, y);
    }
    y += rowHeight;
  }
  y += 5;

  // 6. Summe
  y = maybeNewPage(doc, y, 15);
  doc.text(`Summe: ${formatDeutsch(sum, 2)} €`, MARGIN, y);
  y += 10;

  // 7. Bankverbindung
  if (stammdaten?.bank) {
    const b = stammdaten.bank;
    const lines: string[] = [];
    if (b.iban) lines.push(`IBAN: ${b.iban}`);
    if (b.bic) lines.push(`BIC: ${b.bic}`);
    if (b.bankName) lines.push(b.bankName);
    if (b.kontoinhaber) lines.push(`Kontoinhaber: ${b.kontoinhaber}`);
    if (lines.length > 0) {
      doc.setFontSize(10);
      for (const line of lines) {
        y = maybeNewPage(doc, y, LINE_HEIGHT);
        doc.text(line, MARGIN, y);
        y += LINE_HEIGHT;
      }
    }
  }

  doc.save(buildFilename(stammdaten));
}
