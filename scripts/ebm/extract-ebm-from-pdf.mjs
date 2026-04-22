/**
 * Extrahiert GOP-Einträge aus EBM-PDF (semi-automatisch).
 * Ausgabe: data/ebm-catalog-2026-q2.json + Kopie nach src/data (Vite) + goae-chat.
 *
 * - Volltext: eindeutige 5er-GOPs, Block um erste Zeile "GOP …" mit Euro + Punkte
 * - Ausschlüsse: Zeilen "nicht neben den Gebührenordnungspositionen …" → GOP-Referenzen (inkl. "bis")
 *
 * Nutzung: node scripts/ebm/extract-ebm-from-pdf.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFParse } from "pdf-parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const PDF_PATH = path.join(ROOT, "data/2026-2-ebm.pdf");

const ORIENTIERUNGSWERT = 12.7404; // Cent pro Punkt, Spec 06 / KBV 2026
const VERSION = "2026-Q2";
const GUELTIG_AB = "2026-04-01";

/** Euro in DE-Format, vor Punkte-Zeile */
const EURO_THEN_PUNKTE = /([\d.,]+)\s*€\s*[\r\n]+\s*(\d{1,4})\s*Punkte/gi;
/** Alternative: "196 Punkte" nahe hinter GOP (ohne striktes Euro-Zwang) */
const PUNKTE_ALONE = /(\d{1,4})\s*Punkte\b/gi;

/**
 * "01410 bis 01413" / "01410 – 01413" → fünf stellige Strings
 * @param {string} s
 * @returns {string[]}
 */
function expandBisToGops(s) {
  const out = new Set();
  const bis = /(\d{5})\s*(?:bis|-|–|—)\s*(\d{5})/gi;
  let m;
  const copy = s;
  let rest = copy;
  while ((m = bis.exec(copy)) !== null) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (Number.isFinite(a) && Number.isFinite(b) && a <= b && b - a < 2000) {
      for (let n = a; n <= b; n++) {
        out.add(String(n).padStart(5, "0"));
      }
    }
    rest = rest.replace(m[0], " ");
  }
  return { expanded: [...out], rest };
}

/**
 * Freitextfragment → Liste 5-stelliger GOPs + Bis-Expansion
 * @param {string} fragment
 */
function extractGopRefs(fragment) {
  if (!fragment || fragment.length < 5) return [];
  const { expanded, rest } = expandBisToGops(fragment);
  const single = new Set(expanded);
  const gopRe = /\b(\d{5})\b/g;
  let m;
  while ((m = gopRe.exec(rest)) !== null) {
    if (m[1] !== "00000") single.add(m[1]);
  }
  return [...single];
}

/**
 * @param {string} block
 * @param {string} gop
 */
function parseAusschluesseFromBlock(block) {
  const auss = new Set();
  const copy = block;
  const re =
    /nicht\s+neb(?:en|an)\s+den(?:\s+folgenden)?\s+Geb(?:ührenordnungspositionen?|ehrenordnungspositionen?)?\s*([\s\S]+?)(?=\n\s*Die\s+Geb|\n\s*\d{5}\s+[A-ZÄÖÜa-zäöü]|$)/gi;
  let m;
  while ((m = re.exec(copy)) !== null) {
    for (const g of extractGopRefs(m[1])) auss.add(g);
  }
  for (const line of copy.split("\n")) {
    if (!/nicht\s+neb/i.test(line) && !/nicht\s+neb(?:en|an)\s+am\b/i.test(line)) continue;
    for (const g of extractGopRefs(line)) auss.add(g);
  }
  const re2 = /nicht\s+neb(?:en|an)\s+(?:der|den)\s+Geb(?:ührenordnungsposition)?\s+(\d{5})/gi;
  while ((m = re2.exec(copy)) !== null) auss.add(m[1]);
  return [...auss].filter((x) => x && x.length === 5);
}

/**
 * @param {string} block
 */
function parsePflichtKombiFromBlock(block) {
  const pfl = new Set();
  const re =
    /(?:nur\s+in\s+Verbindung\s+mit|gemeinsam\s+mit|zusammen\s+mit)\s+(?:den\s+)?(?:Geb(?:ührenordnungspositionen?)?\s+)?([^\n.]+)/gi;
  let m;
  while ((m = re.exec(block)) !== null) {
    for (const g of extractGopRefs(m[1])) pfl.add(g);
  }
  return [...pfl].filter((x) => x && x.length === 5);
}

/**
 * @param {string} text
 * @param {string} gop
 * @returns {{ punkt: number, euro: number, block: string }}
 */
function extractBlockForGop(text, gop) {
  const lineRe = new RegExp(`^${gop}\\b`, "m");
  const lm = lineRe.exec(text);
  const idx = lm ? lm.index : text.indexOf(gop);
  if (idx < 0) return { punkt: 0, euro: 0, block: "" };
  // bis zur nächsten GOP-Zeile (5 Ziffern + Leer + Buchstabe) oder 4500 Zeichen
  const sub = text.slice(idx, idx + 4500);
  const nextGop = /\n(\d{5})\s+[^\d\s\n]/m;
  const nxt = sub.slice(1).search(nextGop);
  const block = nxt >= 0 ? sub.slice(0, nxt + 1) : sub;

  let punkt = 0;
  let euro = 0;

  EURO_THEN_PUNKTE.lastIndex = 0;
  let m;
  if ((m = EURO_THEN_PUNKTE.exec(block)) !== null) {
    const rawEuro = m[1].replace(/\./g, "").replace(",", ".");
    euro = Math.round(parseFloat(rawEuro) * 100) / 100;
    punkt = parseInt(m[2], 10) || 0;
  }

  if (!punkt) {
    PUNKTE_ALONE.lastIndex = 0;
    const p2 = PUNKTE_ALONE.exec(block);
    if (p2) punkt = parseInt(p2[1], 10) || 0;
  }

  if (punkt && !euro) {
    euro = Math.round(punkt * ORIENTIERUNGSWERT) / 10000;
  }

  if (!punkt && euro) {
    punkt = Math.round((euro * 10000) / ORIENTIERUNGSWERT);
  }

  return { punkt, euro, block };
}

async function main() {
  if (!fs.existsSync(PDF_PATH)) {
    console.error("Missing PDF:", PDF_PATH);
    process.exit(1);
  }
  const buf = fs.readFileSync(PDF_PATH);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const { text, total } = await parser.getText();
  await parser.destroy();

  const normalized = text.replace(/\r\n/g, "\n");

  const gopRe = /\b([0-9]{5})\b/g;
  const gopSet = new Set();
  let gm;
  while ((gm = gopRe.exec(normalized)) !== null) {
    if (gm[1] !== "00000") gopSet.add(gm[1]);
  }

  const gopsMap = new Map();

  const stub = (gop) => ({
    gop,
    bezeichnung: `GOP ${gop}`,
    kapitel: "unknown",
    punktzahl: 0,
    euroWert: 0,
    obligateLeistungsinhalte: [],
    fakultativeLeistungsinhalte: [],
    abrechnungsbestimmungen: {
      arztgruppen: [],
      ausschluss: [],
      pflichtKombination: [],
    },
    anmerkungen: ["auto_extracted_from_pdf"],
  });

  for (const gop of gopSet) {
    const { punkt, euro, block } = extractBlockForGop(normalized, gop);
    let auss = parseAusschluesseFromBlock(block);
    auss = auss.filter((x) => x !== gop);
    const pflicht = parsePflichtKombiFromBlock(block).filter((x) => x !== gop);
    const firstLine = block.split("\n").find((l) => l.trim().startsWith(gop)) || "";
    let bezeichnung = firstLine
      .replace(new RegExp(`^${gop}\\s*`), "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    if (bezeichnung.length < 3) bezeichnung = `GOP ${gop}`;

    const euroWert = euro > 0 ? euro : (punkt > 0 ? Math.round(punkt * ORIENTIERUNGSWERT) / 10000 : 0);

    gopsMap.set(gop, {
      gop,
      bezeichnung,
      kapitel: "unknown",
      punktzahl: punkt,
      euroWert,
      obligateLeistungsinhalte: [],
      fakultativeLeistungsinhalte: [],
      abrechnungsbestimmungen: {
        arztgruppen: [],
        ausschluss: auss,
        pflichtKombination: pflicht,
      },
      anmerkungen: block.length > 0 ? ["auto_extracted_from_pdf"] : ["gop_mentioned_no_block"],
    });
  }

  const gops = [...gopsMap.values()].sort((a, b) => a.gop.localeCompare(b.gop));

  let withPunkte = 0;
  for (const g of gops) {
    if (g.punktzahl > 0) withPunkte++;
  }

  const db = {
    version: VERSION,
    gueltigAb: GUELTIG_AB,
    orientierungswert: ORIENTIERUNGSWERT,
    sourcePdf: "data/2026-2-ebm.pdf",
    extractedAt: new Date().toISOString(),
    pageCount: total,
    allgemeineBestimmungen: [],
    kapitel: [
      {
        nummer: "0",
        bezeichnung: "Automatisch extrahiert (Vollkatalog) — Kapitel-Zuordnung optional nachziehen",
        versorgungsbereich: "uebergreifend",
        praeambel: "",
        gops: gops.map((g) => g.gop),
      },
    ],
    gops,
  };

  const outData = path.join(ROOT, "data/ebm-catalog-2026-q2.json");
  const outSrc = path.join(ROOT, "src/data/ebm-catalog-2026-q2.json");
  fs.writeFileSync(outData, JSON.stringify(db, null, 2), "utf8");
  fs.writeFileSync(outSrc, JSON.stringify(db, null, 2), "utf8");

  const supabaseOut = path.join(ROOT, "supabase/functions/goae-chat/ebm-catalog-2026-q2.json");
  fs.writeFileSync(supabaseOut, JSON.stringify(db, null, 2), "utf8");

  console.log("pages", total);
  console.log("gops_total", gops.length);
  console.log("gops_with_punkte>0", withPunkte);
  console.log("written", outData, outSrc, supabaseOut);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
