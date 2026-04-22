/**
 * GOÄ-Gebührenverzeichnis aus PDF extrahieren → goae-catalog-full.json
 *
 * Nutzt dieselbe Texterkennung wie pdf-ingest (pdfjs). Erwartet tabellarische
 * Zeilen mit Punktzahl + drei Eurobeträgen am Zeilenende (übliches GOÄ-PDF-Layout).
 * „Katalog“-Zeilen nur mit Nr. + Kurztext übernehmen Gebühren vom zuletzt
 * gesehenen Leistungsblock mit Beträgen (ohne eigene Ziffer am Zeilenanfang).
 *
 * Usage:
 *   npx tsx scripts/import-goae-from-pdf.ts /pfad/zur/GOÄ.pdf
 *
 * Schreibt:
 *   src/data/goae-catalog-full.json
 *   supabase/functions/goae-chat/goae-catalog-full.json
 *   src/data/goae-catalog-meta.json
 *
 * Optional: Bestehende Ziffern, die im PDF nicht vorkommen (z. B. Analog A1),
 * werden aus der vorherigen JSON übernommen (--merge-existing, default an).
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractPdfPagesFromBuffer } from "./pdf-ingest/extract-pdf.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

type GoaeEntry = {
  ziffer: string;
  bezeichnung: string;
  punkte: number;
  einfachsatz: number;
  schwellenfaktor: number;
  regelhoechstsatz: number;
  hoechstfaktor: number;
  hoechstsatz: number;
  ausschlussziffern: string[];
  abschnitt: string;
  hinweise?: string;
};

type Rates = {
  punkte: number;
  einfachsatz: number;
  regelhoechstsatz: number;
  hoechstsatz: number;
  schwellenfaktor: number;
  hoechstfaktor: number;
};

function getAbschnitt(ziffer: string): string {
  const num = parseInt(ziffer.replace(/[^0-9]/g, "") || "0", 10);
  if (ziffer.match(/^[A-Z]$|^K[12]$/i)) return "A";
  if (num >= 1 && num <= 109) return "B";
  if (num >= 200 && num <= 449) return "C";
  if (num >= 450 && num <= 498) return "D";
  if (num >= 500 && num <= 569) return "E";
  if (num >= 600 && num <= 793) return "F";
  if (num >= 800 && num <= 887) return "G";
  if (num >= 1001 && num <= 1168) return "H";
  if (num >= 1200 && num <= 1386) return "I";
  if (num >= 1400 && num <= 1639) return "J";
  if (num >= 1700 && num <= 1860) return "K";
  if (num >= 2000 && num <= 3321) return "L";
  if (num >= 3500 && num <= 4787) return "M";
  if (num >= 4800 && num <= 4873) return "N";
  if (num >= 5000 && num <= 5855) return "O";
  if (num >= 6000 && num <= 6018) return "P";
  return "?";
}

function buildRates(punkte: number, e1: number, e2: number, e3: number): Rates {
  const schwellenfaktor = e1 > 0 ? Math.round((e2 / e1) * 100) / 100 : 2.3;
  const hoechstfaktor = e1 > 0 ? Math.round((e3 / e1) * 100) / 100 : 3.5;
  return {
    punkte,
    einfachsatz: Math.round(e1 * 100) / 100,
    regelhoechstsatz: Math.round(e2 * 100) / 100,
    hoechstsatz: Math.round(e3 * 100) / 100,
    schwellenfaktor,
    hoechstfaktor,
  };
}

/** „Punktzahl + 3 Eurobeträge“ – im Text mehrfach vorkommend (ohne $-Anker). */
const TRIPLE_INLINE =
  /\s+(\d{1,5})\s+(\d{1,3})\s*,\s*(\d{1,2})\s+(\d{1,3})\s*,\s*(\d{1,2})\s+(\d{1,3})\s*,\s*(\d{1,2})/g;

/** Nr. 1–8 sind Grundleistungen (typ. Faktor 2,3×); Labor-Misparsing überspringen. */
function putZiffer(map: Map<string, GoaeEntry>, e: GoaeEntry): void {
  if (/^[1-8]$/.test(e.ziffer) && e.schwellenfaktor < 1.9) return;
  map.set(e.ziffer, e);
}

function processKatalogOnlySegment(
  segment: string,
  propagation: Rates | null,
  byZiffer: Map<string, GoaeEntry>,
): void {
  if (!propagation || !segment.trim()) return;
  const preprocessed = preprocessGoaePdfPageText(segment);
  const rawLines = preprocessed.split(/\n/).map((L) => L.trim()).filter(Boolean);
  for (const line of rawLines) {
    const pieces = splitKatalogStuecke(line);
    for (const piece of pieces) {
      const stripped = piece.replace(/^([A-P])\s+Katalog\s+/i, "").trim();
      const headOnly = parseLeistungskopf(stripped);
      if (headOnly) {
        const bez = saeubereKatalogBezeichnung(headOnly.bezeichnung);
        const hi = [headOnly.anlage ? `Anlage ${headOnly.anlage}` : ""].filter(Boolean).join(" ");
        putZiffer(
          byZiffer,
          entryFromRates(headOnly.ziffer, bez, propagation, hi || undefined),
        );
      }
    }
  }
}

/** Text vor Punktzahl + Euro: Tabellenkopf endet oft mit €-Spalten, danach kommt „1 Beratung …“. */
function rowTextNachEuHeader(rest: string): string {
  const splits = [
    /€\s+FACH\s+€\s+FACH\s+€\s+/gi,
    /\s€\s+€\s+€\s+/g,
    /€\s+FACH\s+€\s+FACH\s+€/gi,
  ];
  let tail = rest;
  for (const sep of splits) {
    const parts = tail.split(sep);
    if (parts.length > 1) tail = parts[parts.length - 1] ?? tail;
  }
  return tail.trim();
}

function parseLeistungskopfNachEuHeader(rest: string) {
  const t = rowTextNachEuHeader(rest);
  return parseLeistungskopf(t) ?? parseLeistungskopf(rest.slice(Math.max(0, rest.length - 500)).trim());
}

/** Entfernt Ziffern-Suffix wie „.H 4“ (Anlage) aus dem RO-Wert; liefert Kurz-Hinweis. */
function normalizeZifferToken(raw: string): { ziffer: string; anlage?: string } {
  const t = raw.replace(/\s+/g, "").trim();
  const hm = t.match(/^(\d+)\.H(\d+)$/i);
  if (hm) return { ziffer: `${hm[1]}.H`, anlage: `H${hm[2]}` };
  const hm2 = t.match(/^(\d+)\.?H(\d+)$/i);
  if (hm2 && t.includes("H")) return { ziffer: hm2[1], anlage: `H${hm2[2]}` };
  const m = t.match(/^(\d+(?:\.\s*H\s*\d+)?)/);
  if (!m) return { ziffer: t };
  let z = m[1].replace(/\s+/g, "");
  let anlage: string | undefined;
  const sub = z.match(/^(\d+)\.H(\d+)$/i);
  if (sub) {
    return { ziffer: `${sub[1]}.H`, anlage: `H${sub[2]}` };
  }
  const splitH = z.match(/^(\d+\.?)H(\d+)$/i);
  if (splitH) {
    z = splitH[1].replace(/\.$/, "");
    anlage = `H${splitH[2]}`;
    return { ziffer: z, anlage };
  }
  return { ziffer: z.replace(/\.$/, "") };
}

/** Einstellige Nr. 1–8 sind fast nur Grundleistungen – vermeidet „1 Lipase“ aus Labor-Kolumnen. */
function einstelligeZifferPlausibel(ziffer: string, bezeichnung: string): boolean {
  if (!/^\d$/.test(ziffer)) return true;
  return /beratung|untersuchung|ausstellung|visite|befund|rezept|notfall|toten|leichen|symptom|massenbefund|eingehend|erstkontakt|wiederholungs|einzelfall|psychotherap|zweit|indikations|kontrast|eltern|berufs|haut|organ|gruppe|kurz|neurolog|beschwerdeb|information|struma|schutz|beistand|sterbe|hospiz|früherkennung|schutzimpf|brief|kurzschrift|melde|mitbeurteil|mitberatung|konsiliar|assistenz|individuelle|mitriss|perkutane|psychopharma|beteiligung|umwelt|medikations|diät|ruhe|psychotherapeut|autogenes|progressive|psychoedukativ|auskunft|telefon/i.test(
    bezeichnung,
  );
}

/** Zeilenanfang: optional Zeilenbuchstabe A–P, dann Ziffer, optional *, dann Text. */
function parseLeistungskopf(rest: string): {
  ziffer: string;
  bezeichnung: string;
  anlage?: string;
} | null {
  const r = rest.trim();
  const withLetterStar = r.match(/^([A-P])\s+(\d+)(\s*\.\s*H\s*\d+)?\s*\*\s+(.+)$/i);
  if (withLetterStar) {
    const rawZ = withLetterStar[2] + (withLetterStar[3]?.replace(/\s+/g, "") ?? "");
    const { ziffer, anlage } = normalizeZifferToken(rawZ);
    const bez = withLetterStar[4].trim();
    if (!einstelligeZifferPlausibel(ziffer, bez)) return null;
    return { ziffer, bezeichnung: bez, anlage };
  }
  const withLetterNoStar = r.match(/^([A-P])\s+(\d+(?:\.\s*H\s*\d+)?)\s+(.+)$/i);
  if (withLetterNoStar && !/^\d+\s*,/.test(withLetterNoStar[3])) {
    const { ziffer, anlage } = normalizeZifferToken(withLetterNoStar[2]);
    const tail = withLetterNoStar[3].trim();
    if (/^\d+\s*,/.test(tail)) return null;
    if (!einstelligeZifferPlausibel(ziffer, tail)) return null;
    return { ziffer, bezeichnung: tail, anlage };
  }
  const star = r.match(/^(\d+)(\s*\.\s*H\s*\d+)?\s*\*\s+(.+)$/i);
  if (star) {
    const rawZ = star[1] + (star[2]?.replace(/\s+/g, "") ?? "");
    const { ziffer, anlage } = normalizeZifferToken(rawZ);
    const bez = star[3].trim();
    if (!einstelligeZifferPlausibel(ziffer, bez)) return null;
    return { ziffer, bezeichnung: bez, anlage };
  }
  const plain = r.match(/^(\d+(?:\.\s*H\s*\d+)?)\s+(.+)$/);
  if (plain) {
    const { ziffer, anlage } = normalizeZifferToken(plain[1]);
    const tail = plain[2].trim();
    if (/^\d+\s*,/.test(tail)) return null;
    if (!einstelligeZifferPlausibel(ziffer, tail)) return null;
    return { ziffer, bezeichnung: tail, anlage };
  }
  return null;
}

function entryFromRates(
  ziffer: string,
  bezeichnung: string,
  r: Rates,
  hinweise?: string,
): GoaeEntry {
  const h = hinweise?.trim();
  return {
    ziffer,
    bezeichnung: bezeichnung.replace(/\s+/g, " ").trim(),
    punkte: r.punkte,
    einfachsatz: r.einfachsatz,
    schwellenfaktor: r.schwellenfaktor,
    regelhoechstsatz: r.regelhoechstsatz,
    hoechstfaktor: r.hoechstfaktor,
    hoechstsatz: r.hoechstsatz,
    ausschlussziffern: [],
    abschnitt: getAbschnitt(ziffer),
    ...(h ? { hinweise: h } : {}),
  };
}

/**
 * pdfjs liefert viele Verzeichnisse als eine fortlaufende Zeile. Wir setzen
 * Umbrüche vor typischen Folgezeilen (nach Euro-Tripel, vor [A–P]+Ziffer, vor katalog *).
 */
function preprocessGoaePdfPageText(pageText: string): string {
  let t = pageText;
  t = t.replace(/(\d\s*,\s*\d{1,2})\s+(?=[A-P]\s+)/g, "$1\n");
  t = t.replace(/(\d\s*,\s*\d{1,2})\s+(?=\d+(?:\.\s*H\s*\d+)?\s*\*)/g, "$1\n");
  t = t.replace(/(\d\s*,\s*\d{1,2})\s+(?=[A-P]\s+Katalog\s+\d)/gi, "$1\n");
  t = t.replace(/\s+(?=[A-P]\s+Katalog\s+\d+(?:\.\s*H\s*\d+)?\s*\*)/gi, "\n");
  return t;
}

function splitKatalogStuecke(line: string): string[] {
  const hasStar = line.includes("*") && /\d+(?:\.\s*H\s*\d+)?\s*\*/.test(line);
  const hasH =
    /\d+\s*\.\s*H\s*\d+\s*\*/.test(line) ||
    /\d+\s*\.\s*H\s+\d+\s*\*/.test(line);
  if (!hasStar && !hasH) return [line];
  /** Zuerst „4022 .H 4 *“, sonst teilt `(?=\\d+\\.?H\\s*\\*)` vorzeitig bei „.H“. */
  let parts = line.split(/\s+(?=\d+\s*\.\s*H\s*\d+\s*\*)/);
  if (parts.length <= 1) parts = line.split(/\s+(?=\d+\s*\.\s*H\s+\d+\s*\*)/);
  if (parts.length <= 1) parts = line.split(/\s+(?=\d+(?:\.\s*H\s*\d+)?\s*\*)/);
  let out = parts.map((s) => s.trim()).filter(Boolean);
  for (let pass = 0; pass < 8; pass++) {
    const next: string[] = [];
    let changed = false;
    for (const p of out) {
      const sub = p
        .split(/\s+(?=\d{4}(?:\s*\.\s*H\s*\d+)?\s*\*)/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (sub.length > 1) changed = true;
      next.push(...(sub.length > 1 ? sub : [p]));
    }
    out = next;
    if (!changed) break;
  }
  return out;
}

function saeubereKatalogBezeichnung(bez: string): string {
  return bez
    .replace(/\s+[A-P]\s*$/i, "")
    .replace(/\s+\d+\s*\.\s*H(\s*\d+)?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePdfPagesToEntries(pages: { reading_order_text: string }[]): GoaeEntry[] {
  const byZiffer = new Map<string, GoaeEntry>();
  let propagation: Rates | null = null;

  for (const page of pages) {
    const text = preprocessGoaePdfPageText(page.reading_order_text);
    const matches = [...text.matchAll(TRIPLE_INLINE)];
    let segStart = 0;

    for (const m of matches) {
      const si = m.index ?? 0;
      const segment = text.slice(segStart, si);
      processKatalogOnlySegment(segment, propagation, byZiffer);

      const punkte = parseInt(m[1], 10);
      const e1 = parseFloat(`${m[2]}.${m[3]}`);
      const e2 = parseFloat(`${m[4]}.${m[5]}`);
      const e3 = parseFloat(`${m[6]}.${m[7]}`);
      const rates = buildRates(punkte, e1, e2, e3);
      propagation = rates;

      const rest = segment.trim();
      const head = parseLeistungskopfNachEuHeader(rest);
      if (head) {
        const hi = [head.anlage ? `Anlage ${head.anlage}` : ""].filter(Boolean).join(" ");
        putZiffer(byZiffer, entryFromRates(head.ziffer, head.bezeichnung, rates, hi || undefined));
      }

      segStart = si + m[0].length;
    }

    processKatalogOnlySegment(text.slice(segStart), propagation, byZiffer);
  }

  return [...byZiffer.values()];
}

function sortEntries(a: GoaeEntry, b: GoaeEntry): number {
  const na = parseInt(a.ziffer.replace(/[^0-9]/g, "") || "0", 10);
  const nb = parseInt(b.ziffer.replace(/[^0-9]/g, "") || "0", 10);
  if (na !== nb) return na - nb;
  return a.ziffer.localeCompare(b.ziffer);
}

async function main() {
  const args = process.argv.slice(2);
  const mergeExisting = !args.includes("--no-merge");
  const pdfArg = args.filter((a) => !a.startsWith("--"))[0];
  if (!pdfArg) {
    console.error(
      "Usage: npx tsx scripts/import-goae-from-pdf.ts <path-to.pdf> [--no-merge]",
    );
    process.exit(1);
  }
  const pdfPath = resolve(pdfArg);
  const buf = await readFile(pdfPath);
  const pages = await extractPdfPagesFromBuffer(buf);
  const entries = parsePdfPagesToEntries(pages);
  entries.sort(sortEntries);

  const srcData = join(__dirname, "../src/data/goae-catalog-full.json");
  let mergedFrom = 0;
  if (mergeExisting) {
    try {
      const raw = await readFile(srcData, "utf-8");
      const existing = JSON.parse(raw) as GoaeEntry[];
      const have = new Set(entries.map((e) => e.ziffer));
      for (const e of existing) {
        if (!have.has(e.ziffer)) {
          entries.push(e);
          have.add(e.ziffer);
          mergedFrom++;
        }
      }
      entries.sort(sortEntries);
    } catch {
      /* no prior file */
    }
  }

  const meta = {
    source: "goae-pdf",
    extractedAt: new Date().toISOString(),
    zifferCount: entries.length,
    mergedFallbackCount: mergedFrom,
    pageCount: pages.length,
  };

  const outJson = JSON.stringify(entries, null, 2);
  await writeFile(srcData, outJson, "utf-8");
  const edgePath = join(__dirname, "../supabase/functions/goae-chat/goae-catalog-full.json");
  await writeFile(edgePath, outJson, "utf-8");
  await writeFile(
    join(__dirname, "../src/data/goae-catalog-meta.json"),
    JSON.stringify(meta, null, 2),
    "utf-8",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        zifferCount: entries.length,
        mergedFallbackCount: mergedFrom,
        wrote: [srcData, edgePath],
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
