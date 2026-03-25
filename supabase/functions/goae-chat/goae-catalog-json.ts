/**
 * Kanonischer GOÄ-Katalog als JSON (goae-catalog-full.json).
 * Single source für Regelengine, Service-Billing, selektive Prompts.
 */

import catalogRaw from "./goae-catalog-full.json" with { type: "json" };

export type GoaeCatalogJsonEntry = {
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
  kategorie?: string;
  hinweise?: string;
};

const ENTRIES = catalogRaw as unknown as GoaeCatalogJsonEntry[];

export const GOAE_CATALOG_ENTRIES: readonly GoaeCatalogJsonEntry[] = ENTRIES;

export const goaeByZiffer = new Map<string, GoaeCatalogJsonEntry>(
  ENTRIES.map((e) => [e.ziffer, e]),
);

const ZIFFER_REGEX = /\bGOÄ\s*(\d{1,4}[a-z]?|[A-Z]\d{0,4})\b/gi;
const PLAIN_ZIFFER_REGEX = /\b(\d{1,4})\b/g;

function fmtEuro(n: number): string {
  return `${n.toFixed(2).replace(".", ",")}€`;
}

/** Kompakte Pipe-Zeile (kompatibel mit älterem Katalogtext-Parsing). */
export function formatCatalogEntryLine(e: GoaeCatalogJsonEntry): string {
  const ausschl = e.ausschlussziffern?.length
    ? `Ausschl: ${e.ausschlussziffern.join(",")}`
    : "";
  const base =
    `${e.ziffer}|${e.bezeichnung}|${e.punkte}|${fmtEuro(e.einfachsatz)}|` +
    `${String(e.schwellenfaktor).replace(".", ",")}→${fmtEuro(e.regelhoechstsatz)}|` +
    `${String(e.hoechstfaktor).replace(".", ",")}→${fmtEuro(e.hoechstsatz)}`;
  return ausschl ? `${base}|${ausschl}` : base;
}

export const GOAE_KATALOG_HEADER = `
# GOÄ-Ziffernkatalog (Auszug aus DocBill-JSON)
## Punktwert: 0,0582873 € (aktuell)

## Steigerungsfaktoren
- Persönliche ärztliche Leistungen: Schwelle 2,3× (max 3,5×)
- Medizinisch-technische Leistungen: Schwelle 1,8× (max 2,5×)
- Laborleistungen Abschnitt M: Schwelle 1,15× (max 1,3×)
- Über Schwellenwert: schriftliche Begründung erforderlich
`.trim();

/** Regelengine-Katalogeintrag (kompatibel zu pipeline/regelengine.ts). */
export type RegelKatalogEintrag = {
  ziffer: string;
  bezeichnung: string;
  punkte: number;
  schwellenfaktor: number;
  hoechstfaktor: number;
  ausschlussziffern: string[];
  abschnitt: string;
};

export function buildRegelKatalogMapFromJson(): Map<string, RegelKatalogEintrag> {
  const map = new Map<string, RegelKatalogEintrag>();
  for (const e of ENTRIES) {
    map.set(e.ziffer, {
      ziffer: e.ziffer,
      bezeichnung: e.bezeichnung,
      punkte: e.punkte,
      schwellenfaktor: e.schwellenfaktor,
      hoechstfaktor: e.hoechstfaktor,
      ausschlussziffern: [...(e.ausschlussziffern ?? [])],
      abschnitt: e.abschnitt ?? "",
    });
  }
  return map;
}

/** Service-Billing Map (nur numerische Faktoren für Betrag). */
export type ServiceKatalogEintrag = {
  punkte: number;
  schwellenfaktor: number;
  hoechstfaktor: number;
  bezeichnung: string;
};

export function buildServiceKatalogMapFromJson(): Map<string, ServiceKatalogEintrag> {
  const map = new Map<string, ServiceKatalogEintrag>();
  for (const e of ENTRIES) {
    map.set(e.ziffer, {
      punkte: e.punkte,
      schwellenfaktor: e.schwellenfaktor,
      hoechstfaktor: e.hoechstfaktor,
      bezeichnung: e.bezeichnung,
    });
  }
  return map;
}

function normalizeZiffer(z: string): string {
  return String(z).trim();
}

/** Aus freiem Text: Kandidaten-Ziffern (nur wenn im Katalog). */
export function extractZiffernFromText(text: string): string[] {
  const found = new Set<string>();
  if (!text) return [];

  let m: RegExpExecArray | null;
  const r1 = new RegExp(ZIFFER_REGEX);
  while ((m = r1.exec(text)) !== null) {
    const z = normalizeZiffer(m[1]);
    if (goaeByZiffer.has(z)) found.add(z);
  }

  const r2 = new RegExp(PLAIN_ZIFFER_REGEX, "g");
  while ((m = r2.exec(text)) !== null) {
    const z = normalizeZiffer(m[1]);
    if (goaeByZiffer.has(z)) found.add(z);
  }

  return [...found];
}

/** Erweitert um Ausschlussziffern (transitiv). */
export function expandZiffernMitAusschlüssen(seed: Iterable<string>): Set<string> {
  const want = new Set<string>();
  for (const z of seed) {
    const n = normalizeZiffer(z);
    if (goaeByZiffer.has(n)) want.add(n);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const z of [...want]) {
      const row = goaeByZiffer.get(z);
      if (!row?.ausschlussziffern) continue;
      for (const a of row.ausschlussziffern) {
        const na = normalizeZiffer(a);
        if (goaeByZiffer.has(na) && !want.has(na)) {
          want.add(na);
          changed = true;
        }
      }
    }
  }
  return want;
}

export type SelectiveCatalogOptions = {
  /** Ziffern inkl. erweiterter Ausschlüsse */
  ziffern: Set<string>;
  maxLines?: number;
  /** Titel-Unterzeile im Markdown */
  subtitle?: string;
};

export function buildSelectiveCatalogMarkdown(opts: SelectiveCatalogOptions): string {
  const maxLines = opts.maxLines ?? 120;
  const lines: string[] = [GOAE_KATALOG_HEADER, "", opts.subtitle ?? "## Relevante Ziffern (JSON-Auszug)", ""];

  const sorted = [...opts.ziffern].filter((z) => goaeByZiffer.has(z)).sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    const ia = isNaN(na) ? 99999 : na;
    const ib = isNaN(nb) ? 99999 : nb;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });

  let n = 0;
  for (const z of sorted) {
    if (n >= maxLines) break;
    const e = goaeByZiffer.get(z);
    if (!e) continue;
    lines.push(formatCatalogEntryLine(e));
    n++;
  }

  if (sorted.length > maxLines) {
    lines.push("");
    lines.push(`_(weitere ${sorted.length - maxLines} Ziffern ausgeblendet; erhöhe maxLines oder schärfe die Frage.)_`);
  }

  lines.push(
    "",
    "## Wichtige GOÄ-Abrechnungsregeln (Kurz)",
    "1. Ausschlussziffern beachten",
    "2. Steigerungsbegründung über Schwellenwert erforderlich",
    "3. Zielleistungsprinzip",
    "4. Analogbewertung mit Begründung",
  );

  return lines.join("\n");
}

/** Fallback: Augenheilkunde Abschnitt I, begrenzt. */
export function buildFallbackAugenCatalogMarkdown(maxLines = 55): string {
  const ziffern = new Set<string>();
  for (const e of ENTRIES) {
    if (e.abschnitt === "I") ziffern.add(e.ziffer);
  }
  for (const z of ["1", "2", "3", "4", "5", "6", "7", "8"]) ziffern.add(z);
  return buildSelectiveCatalogMarkdown({
    ziffern,
    maxLines,
    subtitle: "## Abschnitt I (Augenheilkunde) + Grundleistungen 1–8 (Fallback)",
  });
}

/** Katalogzeilen für GOÄ-Mapping-LLM: Abschnitt I + Kernziffern + aus Text/Leistungen. */
export function buildMappingCatalogMarkdown(params: {
  leistungTexts: string[];
  fachgebiet?: string;
  maxLines?: number;
}): string {
  const maxLines = params.maxLines ?? 180;
  const want = new Set<string>();

  for (const z of ["1", "2", "3", "4", "5", "6", "7", "8", "200", "250", "252", "253"]) {
    if (goaeByZiffer.has(z)) want.add(z);
  }

  const fg = (params.fachgebiet ?? "").toLowerCase();
  const augen = fg.includes("augen") || fg.length === 0;
  if (augen) {
    for (const e of ENTRIES) {
      if (e.abschnitt === "I") want.add(e.ziffer);
    }
  }

  for (const t of params.leistungTexts) {
    for (const z of extractZiffernFromText(t)) want.add(z);
  }

  expandZiffernMitAusschlüssen(want);

  return buildSelectiveCatalogMarkdown({
    ziffern: want,
    maxLines,
    subtitle: "## GOÄ-Katalog (Auszug für Zuordnung)",
  });
}

/** Chat: letzte Nutzer-Turns durchsuchen + relevante Ziffern. */
export function buildChatSelectiveCatalogMarkdown(
  messages: { role: string; content: unknown }[],
  maxLines = 100,
): string {
  const texts: string[] = [];
  for (const m of messages.slice(-8)) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") texts.push(m.content);
  }
  const combined = texts.join("\n");
  const found = extractZiffernFromText(combined);
  if (found.length === 0) {
    return buildFallbackAugenCatalogMarkdown(Math.min(maxLines, 60));
  }

  const seed = new Set<string>([...found, "1", "2", "3", "4", "5", "6", "7", "8"]);
  const expanded = expandZiffernMitAusschlüssen(seed);

  return buildSelectiveCatalogMarkdown({
    ziffern: expanded,
    maxLines,
    subtitle: "## GOÄ-Katalog (relevante Ziffern aus Konversation)",
  });
}
