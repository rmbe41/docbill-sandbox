/**
 * EBM-Datenbank (KBV) als JSON — `specs/06_ARCHITECTURE.md` (Abschnitt 8.7) und Wissensbasis 7.1.
 *
 * **Abgleich (Paket G):** `ebm-catalog-2026-q2.json` liefert GOP-Positionen, Kapitelpräambeln
 * und strukturierte `EbmBestimmung`-Einträge. Was außerhalb des extrahierten PDFs/JSONs liegt
 * (z. B. lange allgemeine Vertragsketten, randständige Anlagen), ist nicht Teil dieser Datei —
 * Lücken werden bei Bedarf durch erneute Extraktion (`scripts/ebm/`) und Version bump geschlossen.
 * Die Laufzeit-Pipeline importiert **dieses** Modul; UI und Tests spiegeln die gleiche Datei unter
 * `src/data/` bzw. Edge-Bundle.
 */
import ebmRaw from "./ebm-catalog-2026-q2.json" with { type: "json" };

export type EbmAbrechnungsbestimmungen = {
  frequenz?: string;
  alter?: string;
  arztgruppen: string[];
  ausschluss: string[];
  pflichtKombination: string[];
};

export type EbmGebuerenordnungsposition = {
  gop: string;
  bezeichnung: string;
  kapitel: string;
  punktzahl: number;
  euroWert: number;
  obligateLeistungsinhalte: string[];
  fakultativeLeistungsinhalte: string[];
  abrechnungsbestimmungen: EbmAbrechnungsbestimmungen;
  anmerkungen: string[];
  zuschlaege?: { gop: string; bedingung: string }[];
};

export type EbmKapitel = {
  nummer: string;
  bezeichnung: string;
  versorgungsbereich: "hausaerztlich" | "fachaerztlich" | "uebergreifend";
  praeambel: string;
  gops: string[];
};

export type EbmBestimmung = {
  nummer: string;
  titel: string;
  inhalt: string;
  betroffeneGops?: string[];
};

export type EbmDatenbank = {
  version: string;
  gueltigAb: string;
  orientierungswert: number;
  sourcePdf?: string;
  extractedAt?: string;
  pageCount?: number;
  allgemeineBestimmungen: EbmBestimmung[];
  kapitel: EbmKapitel[];
  gops: EbmGebuerenordnungsposition[];
};

const DB = ebmRaw as EbmDatenbank;

export const EBM_DATENBANK: EbmDatenbank = DB;

export const ebmByGop = new Map<string, EbmGebuerenordnungsposition>(
  DB.gops.map((g) => [g.gop, g]),
);

const GOP_REGEX = /\b(\d{5})\b/g;

function fmtEuro(n: number): string {
  return `${n.toFixed(2).replace(".", ",")}€`;
}

/** Kompakte Zeile (analog GOÄ-Pipe-Format). */
export function formatEbmCatalogEntryLine(e: EbmGebuerenordnungsposition): string {
  const obs = e.obligateLeistungsinhalte?.length
    ? `Obligat: ${e.obligateLeistungsinhalte.slice(0, 3).join(";")}`
    : "";
  const base = `${e.gop}|${e.bezeichnung}|${e.punktzahl} Punkte|${fmtEuro(e.euroWert)}`;
  return obs ? `${base}|${obs}` : base;
}

export const EBM_KATALOG_HEADER = `
# EBM–GOP-Katalog (Auszug aus DocBill-JSON)
## Version ${DB.version}, gültig ab ${DB.gueltigAb}
## Orientierungswert: ${DB.orientierungswert} Cent pro Punkt
`.trim();

/** Aus Freitext: GOPs, die im Katalog existieren. */
export function extractGopsFromText(text: string): string[] {
  const found = new Set<string>();
  if (!text) return [];
  let m: RegExpExecArray | null;
  const r = new RegExp(GOP_REGEX);
  while ((m = r.exec(text)) !== null) {
    const g = m[1];
    if (ebmByGop.has(g)) found.add(g);
  }
  return [...found];
}

export type SelectiveEbmCatalogOptions = {
  gops: Set<string>;
  maxLines?: number;
  subtitle?: string;
  priorityGops?: Set<string> | string[];
};

function sortGopListe(ids: string[]): string[] {
  return [...ids].filter((g) => ebmByGop.has(g)).sort((a, b) => a.localeCompare(b));
}

function normalizePrioritySet(raw: SelectiveEbmCatalogOptions["priorityGops"]): Set<string> {
  if (!raw) return new Set();
  if (raw instanceof Set) return new Set([...raw].map((z) => String(z).trim()).filter(Boolean));
  return new Set(raw.map((z) => String(z).trim()).filter(Boolean));
}

export function buildSelectiveEbmCatalogMarkdown(opts: SelectiveEbmCatalogOptions): string {
  const maxFillerLines = opts.maxLines ?? 120;
  const lines: string[] = [EBM_KATALOG_HEADER, "", opts.subtitle ?? "## Relevante GOPs (JSON-Auszug)", ""];

  const allValid = sortGopListe([...opts.gops]);
  const prioritySet = normalizePrioritySet(opts.priorityGops);
  const priorityOrdered = sortGopListe([...prioritySet].filter((g) => opts.gops.has(g)));
  const fillerPool = sortGopListe(allValid.filter((g) => !prioritySet.has(g)));

  const emitted = new Set<string>();

  if (priorityOrdered.length === 0) {
    for (const g of allValid) {
      if (emitted.size >= maxFillerLines) break;
      const e = ebmByGop.get(g);
      if (!e) continue;
      lines.push(formatEbmCatalogEntryLine(e));
      emitted.add(g);
    }
  } else {
    for (const g of priorityOrdered) {
      const e = ebmByGop.get(g);
      if (!e) continue;
      lines.push(formatEbmCatalogEntryLine(e));
      emitted.add(g);
    }
    let fillerCount = 0;
    for (const g of fillerPool) {
      if (fillerCount >= maxFillerLines) break;
      if (emitted.has(g)) continue;
      const e = ebmByGop.get(g);
      if (!e) continue;
      lines.push(formatEbmCatalogEntryLine(e));
      emitted.add(g);
      fillerCount++;
    }
  }

  const hidden = allValid.filter((g) => !emitted.has(g)).length;
  if (hidden > 0) {
    lines.push("");
    lines.push(`_(weitere ${hidden} GOPs ausgeblendet; erhöhe maxLines oder schärfe die Frage.)_`);
  }

  lines.push(
    "",
    "## Hinweis EBM",
    "Punktzahlen und Fachgruppen sind verbindlich dem vollständigen EBM zu entnehmen; dieser Auszug dient der schnellen Orientierung.",
  );

  return lines.join("\n");
}

export function buildFallbackEbmCatalogMarkdown(maxLines = 60): string {
  const gops = new Set<string>();
  for (const e of DB.gops.slice(0, 800)) {
    gops.add(e.gop);
  }
  return buildSelectiveEbmCatalogMarkdown({
    gops,
    maxLines,
    subtitle: "## GOP-Stichprobe (Fallback)",
  });
}

export function buildChatSelectiveEbmCatalogMarkdown(
  messages: { role: string; content: unknown }[],
  maxLines = 100,
): string {
  const texts: string[] = [];
  for (const m of messages.slice(-8)) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") texts.push(m.content);
  }
  const combined = texts.join("\n");
  const found = extractGopsFromText(combined);
  if (found.length === 0) {
    return buildFallbackEbmCatalogMarkdown(Math.min(maxLines, 60));
  }

  const seed = new Set<string>(found);
  return buildSelectiveEbmCatalogMarkdown({
    gops: seed,
    maxLines,
    subtitle: "## EBM-Katalog (relevante GOPs aus Konversation)",
    priorityGops: new Set(found),
  });
}
