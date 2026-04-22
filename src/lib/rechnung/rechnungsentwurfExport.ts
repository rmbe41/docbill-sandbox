/**
 * Spec 04 – Export-Formate: PDF, CSV, PAD.
 * Disclaimer: Spec 00 (Footer / Dateiende für CSV & PAD, Fußtext für PDF).
 */

import { DOCBILL_KI_DISCLAIMER } from "./docbillDisclaimer";
import type { Rechnungsentwurf } from "./rechnungsentwurfTypes";

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function eur(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
}

const CSV_SEP = ";";

/**
 * PVS-naher CSV-Export: Metadaten + eine Zeile pro Position; abschließend Disclaimer-Zeile.
 */
export function rechnungsentwurfToCsv(e: Rechnungsentwurf): string {
  const header = [
    "rechnung_id",
    "batch_id",
    "pseudonym_id",
    "regelwerk",
    "gesamtbetrag_eur",
    "status",
    "erstellt_am",
  ];
  const meta = [
    e.id,
    e.batchId ?? "",
    e.patient.pseudonymId,
    e.regelwerk,
    String(e.gesamtbetrag),
    e.status,
    e.erstelltAm,
  ];
  const posHeader = [
    "pos",
    "ziffer",
    "beschreibung",
    "faktor",
    "punktzahl",
    "anzahl",
    "einzelbetrag_eur",
    "gesamtbetrag_eur",
    "begruendung",
    "is_analog",
    "kennzeichnung",
  ];
  const lines: string[] = [
    `DOCBILL_RECHNUNGSENTWURF;${CSV_SEP}${DOCBILL_KI_DISCLAIMER}`,
    header.join(CSV_SEP),
    meta.map(csvEscape).join(CSV_SEP),
    posHeader.join(CSV_SEP),
  ];
  e.positionen.forEach((p, idx) => {
    lines.push(
      [
        String(idx + 1),
        p.ziffer,
        p.beschreibung,
        p.faktor != null ? String(p.faktor) : "",
        p.punktzahl != null ? String(p.punktzahl) : "",
        String(p.anzahl),
        String(p.einzelbetrag),
        String(p.gesamtbetrag),
        p.begruendung ?? "",
        p.isAnalog ? "1" : "0",
        p.kennzeichnung,
      ]
        .map(csvEscape)
        .join(CSV_SEP),
    );
  });
  e.hinweise.forEach((h) => {
    lines.push(
      [
        "HINWEIS",
        String(h.positionIndex + 1),
        h.typ,
        h.text,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]
        .map(csvEscape)
        .join(CSV_SEP),
    );
  });
  e.einwilligungsHinweise.forEach((eh) => {
    lines.push(
      [
        "EINWILLIGUNG",
        String(eh.positionIndex + 1),
        eh.text,
        eh.quelle,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]
        .map(csvEscape)
        .join(CSV_SEP),
    );
  });
  lines.push(`DISCLAIMER${CSV_SEP}${csvEscape(DOCBILL_KI_DISCLAIMER)}`);
  return lines.join("\n");
}

/**
 * PAD-ähnlicher Key=value-Block (Re-Import in PVS) gemäß gängiger Stapel-Darstellung; kein herstellereigenes BDT-Format nötig in Spec 04.
 */
export function rechnungsentwurfToPadBlock(e: Rechnungsentwurf): string {
  const lines: string[] = [
    "FORMAT=DocBill_RECHNUNGSENTWURF",
    "EXPORT_TYP=PAD_TEXT",
    `RECHNUNG_ID=${e.id}`,
    e.batchId ? `BATCH_ID=${e.batchId}` : undefined,
    `PAT_PSEUDONYM=${e.patient.pseudonymId}`,
    e.patient.geburtsjahr != null ? `GEBURTSJAHR=${e.patient.geburtsjahr}` : undefined,
    `REGELWERK=${e.regelwerk}`,
    `GESAMTBETRAG_EUR=${e.gesamtbetrag}`,
    `STATUS=${e.status}`,
    `ERSTELLT=${e.erstelltAm}`,
    "",
  ].filter((x) => x != null) as string[];
  e.positionen.forEach((p, i) => {
    const n = i + 1;
    lines.push(
      `POS_${n}_ZIFFER=${p.ziffer}`,
      `POS_${n}_BESCHREIBUNG=${p.beschreibung.replace(/\n/g, " ")}`,
      `POS_${n}_ANZAHL=${p.anzahl}`,
      `POS_${n}_EINZEL_EUR=${p.einzelbetrag}`,
      `POS_${n}_GESAMT_EUR=${p.gesamtbetrag}`,
      `POS_${n}_ANALOG=${p.isAnalog ? "1" : "0"}`,
      `POS_${n}_KENNZEICHNUNG=${p.kennzeichnung}`,
    );
    if (e.regelwerk === "GOAE" && p.faktor != null) {
      lines.push(`POS_${n}_FAKTOR=${p.faktor}`);
    }
    if (e.regelwerk === "EBM" && p.punktzahl != null) {
      lines.push(`POS_${n}_PUNKTZAHL=${p.punktzahl}`);
    }
    if (p.begruendung) lines.push(`POS_${n}_BEGRUENDUNG=${p.begruendung.replace(/\n/g, " ")}`);
  });
  e.hinweise.forEach((h) => {
    lines.push(
      `HINWEIS_POS_${h.positionIndex + 1}_TYP=${h.typ}`,
      `HINWEIS_POS_${h.positionIndex + 1}_TEXT=${h.text.replace(/\n/g, " ")}`,
    );
  });
  e.einwilligungsHinweise.forEach((eh, j) => {
    lines.push(
      `EINWILLIGUNG_${j + 1}_POS=${eh.positionIndex + 1}`,
      `EINWILLIGUNG_${j + 1}_TEXT=${eh.text.replace(/\n/g, " ")}`,
      `EINWILLIGUNG_${j + 1}_QUELLE=${eh.quelle}`,
    );
  });
  lines.push("", `DISCLAIMER=${DOCBILL_KI_DISCLAIMER}`);
  return lines.join("\n");
}

/**
 * PDF: Rechnungsentwurf als A4-Dokument; Footer mit Spec-00-Disclaimer.
 */
export async function generateRechnungsentwurfPdf(
  e: Rechnungsentwurf,
  docTitle = "Rechnungsentwurf",
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const M = 40;
  const W = doc.internal.pageSize.getWidth();
  const pw = W - 2 * M;
  let y = M;
  const lh = 12;
  const sm = 9;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(docTitle, M, y);
  y += lh + 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(sm);
  doc.text(
    `Pseudonym: ${e.patient.pseudonymId}  |  Regelwerk: ${e.regelwerk}  |  ${eur(e.gesamtbetrag)}  |  ${e.status}`,
    M,
    y,
  );
  y += lh;
  doc.text(`Erstellt: ${e.erstelltAm}`, M, y);
  y += lh + 8;

  doc.setFont("helvetica", "bold");
  doc.text("Positionen", M, y);
  y += lh;
  doc.setFont("helvetica", "normal");
  for (const p of e.positionen) {
    const f =
      e.regelwerk === "GOAE" && p.faktor != null
        ? `Faktor ${p.faktor}  |  `
        : e.regelwerk === "EBM" && p.punktzahl != null
          ? `Punkte ${p.punktzahl}  |  `
          : "";
    const line = `${p.ziffer}  ${f}${p.anzahl}× ${eur(p.einzelbetrag)} = ${eur(p.gesamtbetrag)}  [${p.kennzeichnung}]${
      p.isAnalog ? "  (analog)" : ""
    }`;
    const lines = doc.splitTextToSize(line, pw);
    for (const ln of lines) {
      if (y > 750) {
        doc.addPage();
        y = M;
      }
      doc.text(ln, M, y);
      y += lh - 2;
    }
    const des = doc.splitTextToSize(p.beschreibung, pw);
    for (const ln of des) {
      if (y > 750) {
        doc.addPage();
        y = M;
      }
      doc.setTextColor(80);
      doc.text(ln, M + 8, y);
      doc.setTextColor(0);
      y += lh - 2;
    }
    if (p.begruendung) {
      const bg = doc.splitTextToSize(`Begründung: ${p.begruendung}`, pw - 8);
      for (const ln of bg) {
        if (y > 750) {
          doc.addPage();
          y = M;
        }
        doc.text(ln, M + 8, y);
        y += lh - 2;
      }
    }
    y += 4;
  }

  if (e.hinweise.length) {
    if (y > 700) {
      doc.addPage();
      y = M;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Hinweise", M, y);
    y += lh;
    doc.setFont("helvetica", "normal");
    for (const h of e.hinweise) {
      const t = doc.splitTextToSize(`[Pos. ${h.positionIndex + 1}, ${h.typ}] ${h.text}`, pw);
      for (const ln of t) {
        if (y > 750) {
          doc.addPage();
          y = M;
        }
        doc.text(ln, M, y);
        y += lh - 2;
      }
    }
  }

  if (e.einwilligungsHinweise.length) {
    if (y > 700) {
      doc.addPage();
      y = M;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Einwilligung", M, y);
    y += lh;
    doc.setFont("helvetica", "normal");
    for (const eh of e.einwilligungsHinweise) {
      const t = doc.splitTextToSize(
        `Position ${eh.positionIndex + 1}: ${eh.text} (Quelle: ${eh.quelle})`,
        pw,
      );
      for (const ln of t) {
        if (y > 750) {
          doc.addPage();
          y = M;
        }
        doc.text(ln, M, y);
        y += lh - 2;
      }
    }
  }

  y += 20;
  const disc = doc.splitTextToSize(DOCBILL_KI_DISCLAIMER, pw);
  const footLine = 9;
  const needH = disc.length * footLine;
  if (y + needH > doc.internal.pageSize.getHeight() - 24) {
    doc.addPage();
    y = M;
  }
  doc.setFontSize(8);
  doc.setTextColor(100);
  for (const ln of disc) {
    if (y > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = M;
    }
    doc.text(ln, M, y);
    y += footLine;
  }
  doc.setTextColor(0);

  doc.save(`rechnung-${e.id.slice(0, 8)}.pdf`);
}

/** Mehrere Entwürfe: eine CSV-Datei mit Trennblöcken. */
export function rechnungsentwuerfeToMultiCsv(entwurfe: Rechnungsentwurf[]): string {
  if (entwurfe.length === 0) return `DISCLAIMER${CSV_SEP}${csvEscape(DOCBILL_KI_DISCLAIMER)}`;
  return entwurfe
    .map((e) => rechnungsentwurfToCsv(e))
    .join("\n\n---DOCBILL_BLOCK---\n\n");
}

/** Mehrere Entwürfe: ein PAD-Text mit Trennblöcken. */
export function rechnungsentwuerfeToMultiPad(entwurfe: Rechnungsentwurf[]): string {
  if (entwurfe.length === 0) return `DISCLAIMER=${DOCBILL_KI_DISCLAIMER}`;
  return entwurfe
    .map((e) => rechnungsentwurfToPadBlock(e))
    .join("\n\n---DOCBILL_BLOCK---\n\n");
}

type JsPDF = import("jspdf").jsPDF;

function drawEntwurfIntoDoc(
  doc: JsPDF,
  e: Rechnungsentwurf,
  yStart: number,
  M: number,
  pw: number,
): number {
  const lh = 12;
  const sm = 9;
  let y = yStart;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Rechnungsentwurf", M, y);
  y += lh + 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(sm);
  doc.text(
    `Pseudonym: ${e.patient.pseudonymId}  |  Regelwerk: ${e.regelwerk}  |  ${eur(e.gesamtbetrag)}`,
    M,
    y,
  );
  y += lh;
  doc.text(`Erstellt: ${e.erstelltAm}  |  ID: ${e.id}`, M, y);
  y += lh + 8;
  doc.setFont("helvetica", "bold");
  doc.text("Positionen", M, y);
  y += lh;
  doc.setFont("helvetica", "normal");
  for (const p of e.positionen) {
    const f =
      e.regelwerk === "GOAE" && p.faktor != null
        ? `Faktor ${p.faktor}  |  `
        : e.regelwerk === "EBM" && p.punktzahl != null
          ? `Punkte ${p.punktzahl}  |  `
          : "";
    const line = `${p.ziffer}  ${f}${p.anzahl}× ${eur(p.einzelbetrag)} = ${eur(p.gesamtbetrag)}  [${p.kennzeichnung}]${
      p.isAnalog ? "  (analog)" : ""
    }`;
    for (const ln of doc.splitTextToSize(line, pw)) {
      if (y > 750) {
        doc.addPage();
        y = M;
      }
      doc.text(ln, M, y);
      y += lh - 2;
    }
    for (const ln of doc.splitTextToSize(p.beschreibung, pw)) {
      if (y > 750) {
        doc.addPage();
        y = M;
      }
      doc.setTextColor(80);
      doc.text(ln, M + 8, y);
      doc.setTextColor(0);
      y += lh - 2;
    }
    if (p.begruendung) {
      for (const ln of doc.splitTextToSize(`Begründung: ${p.begruendung}`, pw - 8)) {
        if (y > 750) {
          doc.addPage();
          y = M;
        }
        doc.text(ln, M + 8, y);
        y += lh - 2;
      }
    }
    y += 4;
  }
  const disc = doc.splitTextToSize(DOCBILL_KI_DISCLAIMER, pw);
  y += 8;
  if (y + disc.length * 9 > doc.internal.pageSize.getHeight() - 24) {
    doc.addPage();
    y = M;
  }
  doc.setFontSize(8);
  doc.setTextColor(100);
  for (const ln of disc) {
    if (y > 750) {
      doc.addPage();
      y = M;
    }
    doc.text(ln, M, y);
    y += 10;
  }
  doc.setTextColor(0);
  return y;
}

/**
 * Mehrere Entwürfe in einer PDF, ein Block pro Rechnung (neue Seite ab dem zweiten).
 */
export async function generateRechnungsentwuerfeStapelPdf(
  entwurfe: Rechnungsentwurf[],
  stapelTitel = "DocBill Rechnungsentwürfe (Spec 04)",
  filename = "stapel-rechnungsentwuerfe.pdf",
): Promise<void> {
  if (entwurfe.length === 0) return;
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const M = 40;
  const pw = doc.internal.pageSize.getWidth() - 2 * M;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(stapelTitel, M, M);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const sub = doc.splitTextToSize(DOCBILL_KI_DISCLAIMER, pw);
  let y = M + 16;
  for (const ln of sub) {
    doc.text(ln, M, y);
    y += 10;
  }
  y += 8;
  for (let i = 0; i < entwurfe.length; i += 1) {
    if (i > 0) {
      doc.addPage();
      y = M;
    } else if (y > 700) {
      doc.addPage();
      y = M;
    }
    y = drawEntwurfIntoDoc(doc, entwurfe[i]!, y, M, pw);
  }
  doc.save(filename);
}
