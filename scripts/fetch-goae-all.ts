/**
 * Script: Alle GOÄ-Ziffern von abrechnungsstelle.com fetchen und in goae-catalog.json schreiben.
 * Ausführung: npx tsx scripts/fetch-goae-all.ts
 *
 * URLs gemäß abrechnungsstelle.com:
 * - 1-498, 500-887, 1001-1386, 1400-1860, 2000-2358, 2380-2732, 2750-3097,
 * - 3120-3321, 3500-3615, 3630.H-4014, 4020-4469, 4500-4787, 4800-5380, 5400-6018, analog
 */

const PUNKTWERT = 0.0582873;

const URL_TO_FILE: Record<string, string> = {
  "https://abrechnungsstelle.com/goae/1-498/": "1-498",
  "https://abrechnungsstelle.com/goae/500-887/": "500-887",
  "https://abrechnungsstelle.com/goae/1001-1386/": "1001-1386",
  "https://abrechnungsstelle.com/goae/1400-1860/": "1400-1860",
  "https://abrechnungsstelle.com/goae/2000-2358/": "2000-2358",
  "https://abrechnungsstelle.com/goae/2380-2732/": "2380-2732",
  "https://abrechnungsstelle.com/goae/2750-3097/": "2750-3097",
  "https://abrechnungsstelle.com/goae/3120-3321/": "3120-3321",
  "https://abrechnungsstelle.com/goae/3500-3615/": "3500-3615",
  "https://abrechnungsstelle.com/goae/3630h-4014/": "3630h-4014",
  "https://abrechnungsstelle.com/goae/4020-4469/": "4020-4469",
  "https://abrechnungsstelle.com/goae/4500-4787/": "4500-4787",
  "https://abrechnungsstelle.com/goae/4800-5380/": "4800-5380",
  "https://abrechnungsstelle.com/goae/5400-6018/": "5400-6018",
  "https://abrechnungsstelle.com/goae/goae-abschnitt/analog/": "analog",
};

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
  hinweise?: string;
  abschnitt: string;
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

function parseAusschlussziffern(text: string): string[] {
  const matches = text.matchAll(/\[GOÄ ([^\]]+)\]/g);
  const out: string[] = [];
  for (const m of matches) {
    const z = m[1].trim();
    if (z && !out.includes(z)) out.push(z);
  }
  return out;
}

function parseFloatDE(s: string): number {
  return parseFloat(s.replace(".", "").replace(",", "."));
}

function parsePage(html: string): GoaeEntry[] {
  const entries: GoaeEntry[] = [];
  const blocks = html.split(/GOÄ-Ziffer:\s*/i).slice(1);

  for (const block of blocks) {
    const zifferMatch = block.match(/^([A-Za-z0-9.H]+)/);
    if (!zifferMatch) continue;
    const ziffer = zifferMatch[1].trim().replace(/^goae-/i, "");

    const bezeichnungMatch = block.match(/###\s*GOÄ\s+[^:]+:\s*(.+?)(?:\n|$)/);
    const bezeichnung = bezeichnungMatch ? bezeichnungMatch[1].trim() : "";

    const punkteMatch = block.match(/(\d+(?:[.,]\d+)?)\s*Punkte/);
    const punkte = punkteMatch ? parseFloatDE(punkteMatch[1]) : 0;

    // Einfachsatz: "X,XX €" vor "Einfachsatz" (Markdown hat Leerzeilen)
    const einfMatch = block.match(/(\d+)[.,](\d+)\s*€\s*\n\s*Einfachsatz/);
    const einfachsatz = einfMatch ? parseFloatDE(einfMatch[1] + "," + einfMatch[2]) : punkte * PUNKTWERT;

    // Schwellenfaktor: "X,X" zwischen Einfachsatz und Regelhöchstsatz
    const schwellMatch = block.match(/Einfachsatz\s*\n\s*(\d+)[.,](\d+)\s*\n\s*[\d.,]+\s*€\s*\n\s*Regelhöchstsatz/);
    const schwellenfaktor = schwellMatch ? parseFloatDE(schwellMatch[1] + "," + schwellMatch[2]) : 2.3;

    // Regelhöchstsatz: "X,XX €" vor "Regelhöchstsatz"
    const regMatch = block.match(/(\d+)[.,](\d+)\s*€\s*\n\s*Regelhöchstsatz/);
    const regelhoechstsatz = regMatch ? parseFloatDE(regMatch[1] + "," + regMatch[2]) : einfachsatz * schwellenfaktor;

    // Höchstfaktor: "X,X" zwischen Regelhöchstsatz und Höchstsatz
    const hoechstFMatch = block.match(/Regelhöchstsatz\s*\n\s*(\d+)[.,](\d+)\s*\n\s*[\d.,]+\s*€\s*\n\s*Höchstsatz/);
    const hoechstfaktor = hoechstFMatch ? parseFloatDE(hoechstFMatch[1] + "," + hoechstFMatch[2]) : 3.5;

    // Höchstsatz: "X,XX €" vor "Höchstsatz"
    const hoechstMatch = block.match(/(\d+)[.,](\d+)\s*€\s*\n\s*Höchstsatz/);
    const hoechstsatz = hoechstMatch ? parseFloatDE(hoechstMatch[1] + "," + hoechstMatch[2]) : einfachsatz * hoechstfaktor;

    // Zuschläge (A, B, C, etc.): haben "-" statt Faktoren, kein regMatch/hoechstMatch
    const isZuschlag = !regMatch && block.includes("Regelhöchstsatz") && block.includes("-\n");
    if (isZuschlag) {
      entries.push({
        ziffer,
        bezeichnung,
        punkte,
        einfachsatz,
        schwellenfaktor: 1,
        regelhoechstsatz: einfachsatz,
        hoechstfaktor: 1,
        hoechstsatz: einfachsatz,
        ausschlussziffern: parseAusschlussziffern(block),
        abschnitt: getAbschnitt(ziffer),
      });
    } else {
      entries.push({
        ziffer,
        bezeichnung,
        punkte,
        einfachsatz,
        schwellenfaktor,
        regelhoechstsatz,
        hoechstfaktor,
        hoechstsatz,
        ausschlussziffern: parseAusschlussziffern(block),
        abschnitt: getAbschnitt(ziffer),
      });
    }
  }
  return entries;
}

async function fetchUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "DocBill/1.0 (GOÄ-Katalog-Import)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

async function main() {
  const { readFileSync, writeFileSync, existsSync } = await import("fs");
  const { fileURLToPath } = await import("url");
  const { dirname, join } = await import("path");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dataDir = join(__dirname, "goae-data");

  const all: GoaeEntry[] = [];
  const seen = new Set<string>();

  for (const [url, fileKey] of Object.entries(URL_TO_FILE)) {
    const mdPath = join(dataDir, `${fileKey}.md`);
    let content: string;
    if (existsSync(mdPath)) {
      console.log("Lesen:", mdPath);
      content = readFileSync(mdPath, "utf-8");
    } else {
      console.log("Fetching:", url);
      content = await fetchUrl(url);
      // HTML wird von fetch zurückgegeben – Parsing schlägt fehl. Bitte Markdown manuell speichern.
      if (!content.includes("GOÄ-Ziffer:") && !content.includes("### GOÄ")) {
        console.warn(`  -> Kein Markdown-Format. Bitte ${url} als Markdown in ${mdPath} speichern.`);
        continue;
      }
    }
    try {
      const entries = parsePage(content);
      for (const e of entries) {
        const key = e.ziffer.toUpperCase();
        if (!seen.has(key) && e.bezeichnung) {
          seen.add(key);
          all.push(e);
        }
      }
      console.log(`  -> ${entries.length} Einträge (gesamt: ${all.length})`);
    } catch (err) {
      console.error("  Fehler:", err);
    }
  }

  all.sort((a, b) => {
    const na = parseInt(a.ziffer.replace(/[^0-9]/g, "") || "0", 10);
    const nb = parseInt(b.ziffer.replace(/[^0-9]/g, "") || "0", 10);
    if (na !== nb) return na - nb;
    return a.ziffer.localeCompare(b.ziffer);
  });

  const outPath = join(__dirname, "../src/data/goae-catalog-full.json");
  writeFileSync(outPath, JSON.stringify(all, null, 2), "utf-8");
  console.log("\nGeschrieben:", outPath, "-", all.length, "Ziffern");
}

main().catch(console.error);
