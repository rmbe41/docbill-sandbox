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

/**
 * GOÄ Nr. 1, 2, 3 und Analogziffern – im selben Abrechnungsfall typischerweise
 * nicht nebeneinander berechnungsfähig (Katalog-JSON hatte hier oft leere Ausschlüsse).
 */
export const GOAE_BERATUNG_MUTUALLY_EXCLUSIVE = new Set<string>([
  "1",
  "2",
  "3",
  "A1",
  "A2",
  "A3",
]);

/**
 * Tonometrie 1255–1257: im selben Abrechnungsfall typischerweise nicht nebeneinander
 * berechnungsfähig (Katalog-Import liefert hier oft leere Ausschlüsse).
 */
export const GOAE_TONOMETRIE_MUTUALLY_EXCLUSIVE = new Set<string>([
  "1255",
  "1256",
  "1257",
]);

/**
 * Subjektive (1201) und objektive (1202) Refraktionsbestimmung – im selben Abrechnungsfall
 * typischerweise nicht nebeneinander berechnungsfähig; der JSON-Import liefert dafür oft keine Ausschlussliste.
 */
export const GOAE_REFRACT_SUBJ_OBJ_EXCLUSIVE = new Set<string>(["1201", "1202"]);

/** Expandiert Bereichsangaben wie "1210-1213" zu Einzelziffern (wie Regelengine). */
export function expandGoaeAusschlussRangeTokens(raw: string[]): string[] {
  const result: string[] = [];
  for (const item of raw) {
    const rangeMatch = item.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) result.push(String(i));
    } else {
      result.push(item);
    }
  }
  return result;
}

/** True, wenn laut effektivem Regelkatalog beide Ziffern nicht gemeinsam berechnungsfähig sind. */
export function regelZiffernKollidieren(
  katalog: Map<string, RegelKatalogEintrag>,
  a: string,
  b: string,
): boolean {
  if (a === b) return false;
  const ea = katalog.get(a);
  const eb = katalog.get(b);
  const expA = ea ? expandGoaeAusschlussRangeTokens(ea.ausschlussziffern) : [];
  const expB = eb ? expandGoaeAusschlussRangeTokens(eb.ausschlussziffern) : [];
  return expA.includes(b) || expB.includes(a);
}

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

  for (const [, entry] of map) {
    if (!GOAE_BERATUNG_MUTUALLY_EXCLUSIVE.has(entry.ziffer)) continue;
    const merged = new Set(entry.ausschlussziffern);
    for (const o of GOAE_BERATUNG_MUTUALLY_EXCLUSIVE) {
      if (o !== entry.ziffer) merged.add(o);
    }
    entry.ausschlussziffern = [...merged];
  }

  for (const [, entry] of map) {
    if (!GOAE_TONOMETRIE_MUTUALLY_EXCLUSIVE.has(entry.ziffer)) continue;
    const merged = new Set(entry.ausschlussziffern);
    for (const o of GOAE_TONOMETRIE_MUTUALLY_EXCLUSIVE) {
      if (o !== entry.ziffer) merged.add(o);
    }
    entry.ausschlussziffern = [...merged];
  }

  for (const [, entry] of map) {
    if (!GOAE_REFRACT_SUBJ_OBJ_EXCLUSIVE.has(entry.ziffer)) continue;
    const merged = new Set(entry.ausschlussziffern);
    for (const o of GOAE_REFRACT_SUBJ_OBJ_EXCLUSIVE) {
      if (o !== entry.ziffer) merged.add(o);
    }
    entry.ausschlussziffern = [...merged];
  }

  for (const [, entry] of map) {
    const m = /^A(.+)$/i.exec(entry.ziffer);
    if (!m) continue;
    const baseKey = m[1];
    const baseEntry = map.get(baseKey);
    if (!baseEntry) continue;
    const merged = new Set([
      ...entry.ausschlussziffern,
      ...baseEntry.ausschlussziffern,
    ]);
    merged.delete(entry.ziffer);
    entry.ausschlussziffern = [...merged];
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
      if (GOAE_BERATUNG_MUTUALLY_EXCLUSIVE.has(z)) {
        for (const o of GOAE_BERATUNG_MUTUALLY_EXCLUSIVE) {
          if (o !== z && goaeByZiffer.has(o) && !want.has(o)) {
            want.add(o);
            changed = true;
          }
        }
      }
    }
  }
  return want;
}

export type SelectiveCatalogOptions = {
  /** Ziffern inkl. erweiterter Ausschlüsse */
  ziffern: Set<string>;
  /**
   * Max. Anzahl **Filler**-Ziffern nach allen Prioritätsziffern (ohne Priorität: Gesamtkatalogzeilen).
   * Prioritätsziffern werden immer vollständig ausgegeben und zählen nicht gegen dieses Limit.
   */
  maxLines?: number;
  /** Titel-Unterzeile im Markdown */
  subtitle?: string;
  /**
   * Diese Ziffern (Schnitt mit `ziffern`) werden immer zuerst und vollständig ausgegeben
   * (z. B. aus Nutzertext/Rechnung extrahiert), damit sie bei großen Ausschluss-Mengen nicht abgeschnitten werden.
   */
  priorityZiffern?: Set<string> | string[];
};

function sortZiffernListe(ids: string[]): string[] {
  return [...ids].filter((z) => goaeByZiffer.has(z)).sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    const ia = isNaN(na) ? 99999 : na;
    const ib = isNaN(nb) ? 99999 : nb;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
}

function normalizePrioritySet(raw: SelectiveCatalogOptions["priorityZiffern"]): Set<string> {
  if (!raw) return new Set();
  if (raw instanceof Set) return new Set([...raw].map((z) => String(z).trim()).filter(Boolean));
  return new Set(raw.map((z) => String(z).trim()).filter(Boolean));
}

export function buildSelectiveCatalogMarkdown(opts: SelectiveCatalogOptions): string {
  const maxFillerLines = opts.maxLines ?? 120;
  const lines: string[] = [GOAE_KATALOG_HEADER, "", opts.subtitle ?? "## Relevante Ziffern (JSON-Auszug)", ""];

  const allValid = sortZiffernListe([...opts.ziffern]);
  const prioritySet = normalizePrioritySet(opts.priorityZiffern);
  const priorityOrdered = sortZiffernListe([...prioritySet].filter((z) => opts.ziffern.has(z)));
  const fillerPool = sortZiffernListe(allValid.filter((z) => !prioritySet.has(z)));

  const emitted = new Set<string>();

  if (priorityOrdered.length === 0) {
    for (const z of allValid) {
      if (emitted.size >= maxFillerLines) break;
      const e = goaeByZiffer.get(z);
      if (!e) continue;
      lines.push(formatCatalogEntryLine(e));
      emitted.add(z);
    }
  } else {
    for (const z of priorityOrdered) {
      const e = goaeByZiffer.get(z);
      if (!e) continue;
      lines.push(formatCatalogEntryLine(e));
      emitted.add(z);
    }
    let fillerCount = 0;
    for (const z of fillerPool) {
      if (fillerCount >= maxFillerLines) break;
      if (emitted.has(z)) continue;
      const e = goaeByZiffer.get(z);
      if (!e) continue;
      lines.push(formatCatalogEntryLine(e));
      emitted.add(z);
      fillerCount++;
    }
  }

  const hidden = allValid.filter((z) => !emitted.has(z)).length;
  if (hidden > 0) {
    lines.push("");
    lines.push(`_(weitere ${hidden} Ziffern ausgeblendet; erhöhe maxLines oder schärfe die Frage.)_`);
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
  const priority = new Set<string>();

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
    for (const z of extractZiffernFromText(t)) {
      want.add(z);
      priority.add(z);
    }
  }

  expandZiffernMitAusschlüssen(want);

  return buildSelectiveCatalogMarkdown({
    ziffern: want,
    maxLines,
    subtitle: "## GOÄ-Katalog (Auszug für Zuordnung)",
    priorityZiffern: priority,
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
    priorityZiffern: new Set(found),
  });
}
