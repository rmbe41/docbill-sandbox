/**
 * Logos von den offiziellen Listen (lazy/blocklink-Markup inkl. Thumbor-Redirects).
 *
 * @see https://www.krankenkassen.de/gesetzliche-krankenkassen/krankenkassen-liste/
 * @see https://www.krankenkassen.de/private-krankenversicherung/pkv-liste/
 *
 * Ausgabe: src/data/sandbox/krankenkassenDeLogos.generated.ts
 */
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../src/data/sandbox/krankenkassenDeLogos.generated.ts");

const BASE = "https://www.krankenkassen.de";

const PAGES = [
  `${BASE}/gesetzliche-krankenkassen/krankenkassen-liste/`,
  `${BASE}/private-krankenversicherung/pkv-liste/`,
];

function decodeHtmlEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Direkte /download/… URL oder aus Thumbor-data-src dekodiert */
function logoUrlFromSrc(src) {
  if (!src || src.startsWith("data:")) return null;
  const encoded = src.match(/https%3A%2F%2Fwww\.krankenkassen\.de%2Fdownload%2F[^"]+/);
  if (encoded) return decodeURIComponent(encoded[0]);
  if (src.startsWith("https://www.krankenkassen.de/download/")) return src;
  if (src.startsWith("/download/")) return BASE + src;
  return null;
}

/** Alle Logos aus Listeneinträgen (GKV + PKV). */
function scrapeBlocklinkLogos(html) {
  const map = Object.create(null);
  const re = /<img\b([^>]*\bclass="[^"]*blocklink-liste__logo-img[^"]*"[^>]*)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[1];
    const dataSrc = tag.match(/\bdata-src="([^"]+)"/);
    const srcPlain = tag.match(/\bsrc="([^"]+)"/);
    const altM = tag.match(/\balt="([^"]+)"/);
    if (!altM) continue;
    const raw = dataSrc?.[1] ?? srcPlain?.[1];
    const url = logoUrlFromSrc(raw);
    const name = decodeHtmlEntities(altM[1]).trim();
    if (url && name && map[name] == null) map[name] = url;
  }
  return map;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; DocBill-sandbox-logo-map/1)" },
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

async function main() {
  const merged = Object.create(null);
  for (const url of PAGES) {
    const html = await fetchText(url);
    Object.assign(merged, scrapeBlocklinkLogos(html));
  }

  const keys = Object.keys(merged).sort((a, b) => a.localeCompare(b, "de"));

  const lines = keys.map((k) => {
    const v = merged[k];
    const ks = JSON.stringify(k);
    const vs = JSON.stringify(v);
    return `  ${ks}: ${vs},`;
  });

  const body = `/** Automatisch erzeugt durch \`node scripts/scrape-krankenkassen-logos.mjs\`. Nicht von Hand bearbeiten. */

export const KRANKENKASSEN_DE_LOGO_URL: Record<string, string> = {
${lines.join("\n")}
};
`;

  writeFileSync(OUT, body, "utf8");
  console.log(`Wrote ${keys.length} logo mappings → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
