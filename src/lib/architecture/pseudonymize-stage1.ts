/**
 * Spec 8.2 — Stufe 1: Regex-basierte Pseudonymisierung vor LLM-Verarbeitung.
 * Stufe 2 (NER) liefert zusätzliche `PseudonymRawMatch`-Einträge — siehe Edge `ner-stage2.ts`.
 *
 * Platzhalter enthalten `sessionId`, damit sie in gestreamten Token nicht zerstückelt werden
 * und mehrere Pseudonymisierungen pro Session kombinierbar sind.
 */

import type { PseudonymMap, PseudonymMappingEntry, PseudonymType } from "./spec06-types.ts";

const PLACEHOLDER = (sessionId: string, type: PseudonymType, index: number) =>
  `[[DOCBILL_PII:${sessionId}:${type}:${index}]]`;

const TWENTY_FOUR_H_MS = 24 * 60 * 60 * 1000;

function addExpiresAtIso(): string {
  return new Date(Date.now() + TWENTY_FOUR_H_MS).toISOString();
}

/** regex = 0 (bei Überlappung bevorzugt), ner = 1 */
export type PseudonymMatchSource = "regex" | "ner";

export type PseudonymRawMatch = {
  start: number;
  end: number;
  original: string;
  type: PseudonymType;
  source: PseudonymMatchSource;
};

function sourcePriority(s: PseudonymMatchSource): number {
  return s === "regex" ? 0 : 1;
}

export function initialPerTypeCounters(): Record<PseudonymType, number> {
  return { person: 0, date: 0, insurance_id: 0, address: 0, phone: 0, email: 0 };
}

/** Nächste freie Indexnummer pro Typ aus bestehender Map (für Redis-Session). */
export function nextPerTypeCountersFromMap(map: PseudonymMap | null | undefined): Record<PseudonymType, number> {
  const base = initialPerTypeCounters();
  if (!map?.mappings.length) return base;
  const re = /\[\[DOCBILL_PII:([^:]+):([^:]+):(\d+)\]\]/;
  for (const m of map.mappings) {
    const g = re.exec(m.pseudonym);
    if (!g) continue;
    const type = g[2] as PseudonymType;
    const idx = parseInt(g[3], 10);
    if (type in base && Number.isFinite(idx) && idx >= base[type]) {
      base[type] = idx + 1;
    }
  }
  return base;
}

/** Vorher bekannte Originalstrings → Platzhalter (längste zuerst). */
export function substituteExistingMappingsInText(text: string, map: PseudonymMap | null | undefined): string {
  if (!map?.mappings.length) return text;
  let t = text;
  const sorted = [...map.mappings].sort((a, b) => b.original.length - a.original.length);
  for (const { original, pseudonym } of sorted) {
    if (!original.trim()) continue;
    t = t.split(original).join(pseudonym);
  }
  return t;
}

/** Platzhalter durch Leerzeichen gleicher Länge ersetzen (NER auf stabile Positionen). */
export function maskDocbillPlaceholdersForNer(text: string): string {
  return text.replace(/\[\[DOCBILL_PII:[^\]]+\]\]/g, (m) => " ".repeat(m.length));
}

function collectMatches(
  text: string,
  re: RegExp,
  type: PseudonymType,
  source: PseudonymMatchSource,
  out: PseudonymRawMatch[],
): void {
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    const original = m[0];
    if (!original?.trim()) continue;
    out.push({ start: m.index, end: m.index + original.length, original, type, source });
  }
}

export function collectStage1RegexMatches(text: string): PseudonymRawMatch[] {
  const raw: PseudonymRawMatch[] = [];
  collectMatches(
    text,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "email",
    "regex",
    raw,
  );
  collectMatches(
    text,
    /(?:\+49|0)[\s-/]?(?:\d[\s-/]?){6,14}\d\b/g,
    "phone",
    "regex",
    raw,
  );
  collectMatches(text, /\b\d{1,2}\.\d{1,2}\.\d{4}\b/g, "date", "regex", raw);
  collectMatches(text, /\b\d{4}-\d{2}-\d{2}\b/g, "date", "regex", raw);
  collectMatches(
    text,
    /\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]+(?:[-\s][A-ZÄÖÜ]?[a-zäöüß]+)*\b/g,
    "address",
    "regex",
    raw,
  );
  collectMatches(text, /\b[A-Z]\d{9}\b/g, "insurance_id", "regex", raw);
  collectMatches(
    text,
    /(?:Herr|Frau|Dr\.|Prof\.(?:\s+Dr\.)?)\s+[A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)+\b/g,
    "person",
    "regex",
    raw,
  );
  return raw;
}

export function mergeNonOverlappingMatches(matches: PseudonymRawMatch[]): PseudonymRawMatch[] {
  const sorted = [...matches].sort(
    (a, b) =>
      b.end - b.start - (a.end - a.start) ||
      sourcePriority(a.source) - sourcePriority(b.source) ||
      a.start - b.start,
  );
  const out: PseudonymRawMatch[] = [];
  for (const m of sorted) {
    const overlaps = out.some((o) => !(m.end <= o.start || m.start >= o.end));
    if (!overlaps) out.push(m);
  }
  return out.sort((a, b) => b.start - a.start);
}

export function mergeAndApplyPseudonymMatches(
  text: string,
  sessionId: string,
  picked: PseudonymRawMatch[],
  startPerType: Record<PseudonymType, number>,
): { text: string; map: PseudonymMap } {
  const perTypeCount = { ...startPerType };
  const mappings: PseudonymMappingEntry[] = [];
  let out = text;
  for (const m of picked) {
    const idx = perTypeCount[m.type]++;
    const pseudonym = PLACEHOLDER(sessionId, m.type, idx);
    mappings.push({ original: m.original, pseudonym, type: m.type });
    out = out.slice(0, m.start) + pseudonym + out.slice(m.end);
  }
  const map: PseudonymMap = {
    sessionId,
    mappings,
    expiresAt: addExpiresAtIso(),
  };
  return { text: out, map };
}

/**
 * Nur Regex (Stufe 1), ohne Redis/NER — für Tests und schmale Aufrufer.
 */
export function pseudonymizeTextStage1(text: string, sessionId: string): { text: string; map: PseudonymMap } {
  const picked = mergeNonOverlappingMatches(collectStage1RegexMatches(text));
  return mergeAndApplyPseudonymMatches(text, sessionId, picked, initialPerTypeCounters());
}

/** Stellt PII in einem String wieder her (längste Pseudonyme zuerst). */
export function reidentifyText(text: string, map: PseudonymMap): string {
  if (!map.mappings.length) return text;
  const sorted = [...map.mappings].sort((a, b) => b.pseudonym.length - a.pseudonym.length);
  let s = text;
  for (const { pseudonym, original } of sorted) {
    s = s.split(pseudonym).join(original);
  }
  return s;
}

export function reidentifyMedizinischeAnalyse<
  D extends { text: string; icdCode?: string },
  B extends { text: string },
>(
  analyse: { diagnosen: D[]; behandlungen: B[]; klinischerKontext: string; fachgebiet: string },
  map: PseudonymMap,
): { diagnosen: D[]; behandlungen: B[]; klinischerKontext: string; fachgebiet: string } {
  return {
    ...analyse,
    klinischerKontext: reidentifyText(analyse.klinischerKontext, map),
    fachgebiet: reidentifyText(analyse.fachgebiet, map),
    diagnosen: analyse.diagnosen.map((d) => ({
      ...d,
      text: reidentifyText(d.text, map),
      icdCode: d.icdCode ? reidentifyText(d.icdCode, map) : d.icdCode,
    })),
    behandlungen: analyse.behandlungen.map((b) => ({
      ...b,
      text: reidentifyText(b.text, map),
    })),
  };
}
