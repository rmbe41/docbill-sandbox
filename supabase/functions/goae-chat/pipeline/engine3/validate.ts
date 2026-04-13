/**
 * Engine 3: JSON validieren, Beträge aus GOÄ-Punkten nachrechnen.
 */

import {
  buildRegelKatalogMapFromJson,
  goaeByZiffer,
  regelZiffernKollidieren,
  type RegelKatalogEintrag,
} from "../../goae-catalog-json.ts";
import { getBegruendungBeispiele } from "./begruendung-beispiele.ts";

let _regelKatalog: Map<string, RegelKatalogEintrag> | null = null;
function getRegelKatalog(): Map<string, RegelKatalogEintrag> {
  if (!_regelKatalog) _regelKatalog = buildRegelKatalogMapFromJson();
  return _regelKatalog;
}

const PUNKTWERT = 0.0582873;

function coerceBegruendungBeispiele(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 3);
  return out.length ? out : undefined;
}

export type Engine3Modus = "rechnung_pruefung" | "leistungen_abrechnen";

export type Engine3PositionStatus = "korrekt" | "warnung" | "fehler" | "vorschlag";

export interface Engine3Position {
  nr: number;
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  status: Engine3PositionStatus;
  anmerkung?: string;
  quelleText?: string;
  begruendung?: string;
  /** Vollständige, wählbare Begründungsvarianten (optional LLM + deterministische Vorlagen). */
  begruendungBeispiele?: string[];
}

export interface Engine3Hinweis {
  schwere: "fehler" | "warnung" | "info";
  titel: string;
  detail: string;
  regelReferenz?: string;
  /** Positionsnummern (`nr`) aus positionen/optimierungen, denen der Hinweis zugeordnet ist */
  betrifftPositionen?: number[];
}

export interface Engine3Summary {
  geschaetzteSumme: number;
  anzahlPositionen: number;
  fehler: number;
  warnungen: number;
}

export interface Engine3ResultData {
  modus: Engine3Modus;
  klinischerKontext: string;
  fachgebiet: string;
  positionen: Engine3Position[];
  hinweise: Engine3Hinweis[];
  optimierungen?: Engine3Position[];
  zusammenfassung: Engine3Summary;
  goaeStandHinweis?: string;
  adminQuellen?: string[];
  /** Vom System gesetzt: nachvollziehbare Grundlagen (GOÄ-Blöcke, Eingabe, Admin-Kontext) */
  quellen?: string[];
}

/** SSE / Client: schlanke Position; Quelle optional für UI (immer gesetzt nach Server-Enforcement). */
export interface Engine3ClientPosition {
  nr: number;
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  status: Engine3PositionStatus;
  quelleText?: string;
}

export interface Engine3ClientTopVorschlag extends Engine3ClientPosition {
  rang: 1 | 2 | 3;
  empfohlen?: boolean;
}

export interface Engine3ClientHinweis {
  schwere: "fehler" | "warnung" | "info";
  titel: string;
  detail: string;
  betrifftPositionen?: number[];
}

export interface Engine3ClientResultData {
  modus: Engine3Modus;
  klinischerKontext: string;
  fachgebiet: string;
  positionen: Engine3ClientPosition[];
  hinweise: Engine3ClientHinweis[];
  optimierungen?: Engine3ClientPosition[];
  topVorschlaege?: Engine3ClientTopVorschlag[];
  zusammenfassung: Engine3Summary;
  /** System: GOÄ-Blöcke, Katalog, Eingabe, RAG-Dateien */
  quellen?: string[];
}

function hinweisCountsForNr(hinweise: Engine3Hinweis[], nr: number): { fehler: number; warnung: number } {
  let fehler = 0;
  let warnung = 0;
  for (const h of hinweise) {
    if (!h.betrifftPositionen?.includes(nr)) continue;
    if (h.schwere === "fehler") fehler += 1;
    else if (h.schwere === "warnung") warnung += 1;
  }
  return { fehler, warnung };
}

export function rankEngine3TopVorschlaege(data: Engine3ResultData): Engine3ClientTopVorschlag[] {
  const all = [...data.positionen, ...(data.optimierungen ?? [])];
  const ranked = all.map((p) => {
    const h = hinweisCountsForNr(data.hinweise, p.nr);
    const statusScore = p.status === "korrekt" || p.status === "vorschlag"
      ? 0
      : p.status === "warnung"
      ? 1
      : 2;
    const missingQuelle = !p.quelleText?.trim();
    return {
      p,
      statusScore,
      fehlerCount: h.fehler,
      warnCount: h.warnung,
      missingQuelle,
    };
  });
  ranked.sort((a, b) =>
    a.statusScore - b.statusScore ||
    a.fehlerCount - b.fehlerCount ||
    a.warnCount - b.warnCount ||
    Number(a.missingQuelle) - Number(b.missingQuelle) ||
    b.p.betrag - a.p.betrag ||
    a.p.ziffer.localeCompare(b.p.ziffer, "de") ||
    a.p.nr - b.p.nr
  );
  return ranked.slice(0, 3).map(({ p }, idx) => ({
    nr: p.nr,
    ziffer: p.ziffer,
    bezeichnung: p.bezeichnung,
    faktor: p.faktor,
    betrag: p.betrag,
    status: p.status,
    ...(p.quelleText?.trim() ? { quelleText: p.quelleText.trim() } : {}),
    rang: (idx + 1) as 1 | 2 | 3,
    ...(idx === 0 ? { empfohlen: true } : {}),
  }));
}

export function toClientEngine3Result(data: Engine3ResultData): Engine3ClientResultData {
  const slimPos = (p: Engine3Position): Engine3ClientPosition => ({
    nr: p.nr,
    ziffer: p.ziffer,
    bezeichnung: p.bezeichnung,
    faktor: p.faktor,
    betrag: p.betrag,
    status: p.status,
    ...(typeof p.quelleText === "string" && p.quelleText.trim()
      ? { quelleText: p.quelleText.trim() }
      : {}),
  });
  const hinweise = data.hinweise
    .filter((h) => h.schwere === "fehler" || h.schwere === "warnung")
    .map((h) => ({
      schwere: h.schwere,
      titel: h.titel,
      detail: h.detail,
      ...(h.betrifftPositionen?.length ? { betrifftPositionen: h.betrifftPositionen } : {}),
    }));
  const optimierungen = data.optimierungen?.map(slimPos);
  const topVorschlaege = rankEngine3TopVorschlaege(data);
  return {
    modus: data.modus,
    klinischerKontext: data.klinischerKontext,
    fachgebiet: data.fachgebiet,
    positionen: data.positionen.map(slimPos),
    hinweise,
    ...(optimierungen?.length ? { optimierungen } : {}),
    ...(topVorschlaege.length ? { topVorschlaege } : {}),
    zusammenfassung: data.zusammenfassung,
    ...(data.quellen?.length ? { quellen: data.quellen } : {}),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normZiffer(z: string): string {
  return String(z ?? "").trim();
}

/** LLMs liefern Ziffern oft als Zahl; sonst schlägt die Validierung mit leerer Ziffer fehl. */
function coerceEngine3Ziffer(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return normZiffer(String(v));
  if (typeof v === "string") {
    const s0 = normZiffer(
      v.replace(/^goä\s*[:\-]?\s*/i, "").replace(/^ziffer\s*[:\-]?\s*/i, ""),
    );
    if (/^\d{1,5}[a-z]?$/i.test(s0)) return s0;
    const m = s0.match(/\b(\d{2,5}[a-z]?)\b/i);
    return m ? normZiffer(m[1]) : s0;
  }
  return "";
}

/** DE-Komma, USD-Punkt und String-Zahlen (häufig bei Rechnungs-LLM-Output). */
function coerceEngine3Number(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return NaN;
  let t = v.trim().replace(/\s/g, "").replace(/€|eur\.?/gi, "").trim();
  if (!t) return NaN;
  if (/^\d{1,3}(\.\d{3})*(,\d+)$/.test(t)) {
    t = t.replace(/\./g, "").replace(",", ".");
    return Number(t);
  }
  if (/^\d+,\d+$/.test(t)) {
    return Number(t.replace(",", "."));
  }
  return Number(t);
}

function normalizeEngine3Status(st: unknown): Engine3PositionStatus | null {
  const s = String(st ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
  if (
    s === "korrekt" ||
    s === "correct" ||
    s === "ok" ||
    s === "gültig" ||
    s === "gueltig" ||
    s === "richtig" ||
    s === "bestätigt" ||
    s === "bestaetigt" ||
    s === "in_ordnung" ||
    s === "plausibel"
  ) {
    return "korrekt";
  }
  if (s === "warnung" || s === "warning" || s === "beanstandung" || s === "teilweise") return "warnung";
  if (s === "fehler" || s === "error" || s === "ungültig" || s === "abgelehnt") return "fehler";
  if (s === "vorschlag" || s === "suggestion" || s === "optimierung") return "vorschlag";
  return null;
}

function normalizeHinweisSchwere(v: unknown): "fehler" | "warnung" | "info" | null {
  const s = String(v ?? "").toLowerCase().trim();
  if (s === "fehler" || s === "error") return "fehler";
  if (s === "warnung" || s === "warning") return "warnung";
  if (s === "info" || s === "information" || s === "hinweis") return "info";
  return null;
}

/** Extrahiert Positionsnummern für Hinweis-Zuordnung (tolerant gegen LLM-Varianten). */
function normalizeBetrifftPositionen(raw: unknown): number[] | undefined {
  const out: number[] = [];
  const add = (n: number) => {
    const r = Math.round(n);
    if (!Number.isFinite(r)) return;
    if (!out.includes(r)) out.push(r);
  };
  if (raw == null || raw === "") return undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    add(raw);
    return out.length ? out : undefined;
  }
  if (typeof raw === "string") {
    for (const part of raw.split(/[,;\s]+/)) {
      const t = part.trim();
      if (!t) continue;
      const n = Number(t);
      if (Number.isFinite(n)) add(n);
    }
    return out.length ? out : undefined;
  }
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x === "number" && Number.isFinite(x)) add(x);
      else if (typeof x === "string") {
        const n = Number(x.trim());
        if (Number.isFinite(n)) add(n);
      }
    }
    return out.length ? out : undefined;
  }
  return undefined;
}

function coerceEngine3TextField(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (v === null || v === undefined) return "";
  return null;
}

/** Positionsliste: Aliase, JSON-String oder einzelnes Positionsobjekt. */
function normalizeEngine3PositionList(o: Record<string, unknown>): unknown[] | null {
  let raw: unknown =
    o.positionen ??
    o.positions ??
    o.Positionen ??
    o.rechnungspositionen ??
    o.leistungen ??
    o.items;
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw.trim());
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && !Array.isArray(raw)) return [raw];
  return null;
}

function hasEngine3PositionList(o: Record<string, unknown>): boolean {
  return normalizeEngine3PositionList(o) !== null;
}

/** Sucht die verschachtelte Objektform mit Positionsliste (LLM wrapper / beliebige Key-Namen). */
function unwrapEngine3Candidate(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const root = raw as Record<string, unknown>;
  const queue: Record<string, unknown>[] = [root];
  const seen = new Set<unknown>();

  for (let i = 0; i < 80 && queue.length > 0; i++) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (hasEngine3PositionList(cur)) return cur;
    for (const k of Object.keys(cur)) {
      const inner = cur[k];
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        queue.push(inner as Record<string, unknown>);
      }
    }
  }
  return root;
}

function recordFromUnknown(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function katalogEintrag(ziffer: string) {
  const z = normZiffer(ziffer);
  return goaeByZiffer.get(z) ?? goaeByZiffer.get(z.toUpperCase());
}

function fixPosition(p: Engine3Position): Engine3Position {
  const entry = katalogEintrag(p.ziffer);
  if (!entry) {
    const note = p.anmerkung?.trim() ?? "";
    const add = "Ziffer im eingebetteten GOÄ-Auszug nicht gefunden – Betrag nicht automatisch geprüft.";
    return {
      ...p,
      status: p.status === "korrekt" ? "warnung" : p.status,
      anmerkung: note ? `${note} ${add}` : add,
    };
  }
  const expected = round2(entry.punkte * PUNKTWERT * p.faktor);
  if (Math.abs(expected - p.betrag) > 0.03) {
    const note = p.anmerkung?.trim() ?? "";
    const add = `Betrag an Punktwert (${entry.punkte} Pt) und Faktor nachgerechnet: ${expected.toFixed(2).replace(".", ",")} €.`;
    return {
      ...p,
      betrag: expected,
      bezeichnung: p.bezeichnung || entry.bezeichnung,
      anmerkung: note ? `${note} ${add}` : add,
    };
  }
  if (!p.bezeichnung.trim()) {
    return { ...p, bezeichnung: entry.bezeichnung };
  }
  return p;
}

function summarize(data: Engine3ResultData): Engine3Summary {
  const all = [...data.positionen, ...(data.optimierungen ?? [])];
  const geschaetzteSumme = round2(all.reduce((s, p) => s + p.betrag, 0));
  const fehler = data.hinweise.filter((h) => h.schwere === "fehler").length +
    data.positionen.filter((p) => p.status === "fehler").length +
    (data.optimierungen?.filter((p) => p.status === "fehler").length ?? 0);
  const warnungen = data.hinweise.filter((h) => h.schwere === "warnung").length +
    data.positionen.filter((p) => p.status === "warnung").length +
    (data.optimierungen?.filter((p) => p.status === "warnung").length ?? 0);
  return {
    geschaetzteSumme,
    anzahlPositionen: data.positionen.length,
    fehler,
    warnungen,
  };
}

/** Rohes Modell-JSON → typisiert; `null` wenn unbrauchbar. */
export function parseEngine3ResultJson(raw: unknown, modus: Engine3Modus): Engine3ResultData | null {
  const rootRec = recordFromUnknown(raw);
  const o = unwrapEngine3Candidate(raw);
  if (!o) return null;
  const klin = coerceEngine3TextField(
    o.klinischerKontext ?? o.klinischer_kontext ?? rootRec?.klinischerKontext ?? rootRec?.klinischer_kontext,
  );
  const fach = coerceEngine3TextField(
    o.fachgebiet ?? o.Fachgebiet ?? rootRec?.fachgebiet ?? rootRec?.Fachgebiet,
  );
  if (klin === null || fach === null) return null;
  const posRaw = normalizeEngine3PositionList(o);
  if (!posRaw) return null;

  const parsePos = (p: unknown, fallbackNr?: number): Engine3Position | null => {
    if (!p || typeof p !== "object" || Array.isArray(p)) return null;
    const r = p as Record<string, unknown>;
    let nr = coerceEngine3Number(r.nr ?? r.position ?? r.pos);
    if (!Number.isFinite(nr) && fallbackNr !== undefined) nr = fallbackNr;
    let ziffer = coerceEngine3Ziffer(
      r.ziffer ?? r.Ziffer ?? r.goae_ziffer ?? r.goaeZiffer ?? r.code ?? r.ziffer_nr,
    );
    const bezeichnung =
      typeof r.bezeichnung === "string"
        ? r.bezeichnung
        : typeof r.bezeichnung === "number" && Number.isFinite(r.bezeichnung)
          ? String(r.bezeichnung)
          : "";
    if (!ziffer && bezeichnung) {
      const m = bezeichnung.match(/\b(\d{3,5}[a-z]?)\b/i);
      if (m) ziffer = normZiffer(m[1]);
    }
    if (!ziffer) ziffer = "?";
    const faktor = coerceEngine3Number(r.faktor ?? r.honorarfaktor ?? r.steigerung);
    const betrag = coerceEngine3Number(r.betrag ?? r.betragEuro ?? r.summe ?? r.betrag_eur ?? r.betrag_netto);
    const statusRaw = r.status ?? r.Status;
    let st = normalizeEngine3Status(statusRaw);
    if (!st) {
      if (statusRaw === undefined || statusRaw === null || (typeof statusRaw === "string" && !statusRaw.trim())) {
        st = "korrekt";
      } else {
        st = "warnung";
      }
    }
    if (!Number.isFinite(nr) || !Number.isFinite(faktor) || !Number.isFinite(betrag)) {
      return null;
    }
    const beisp = coerceBegruendungBeispiele(r.begruendungBeispiele);
    return {
      nr: Math.round(nr),
      ziffer,
      bezeichnung,
      faktor,
      betrag: round2(betrag),
      status: st,
      ...(typeof r.anmerkung === "string" ? { anmerkung: r.anmerkung } : {}),
      ...(typeof r.quelleText === "string" ? { quelleText: r.quelleText } : {}),
      ...(typeof r.begruendung === "string" ? { begruendung: r.begruendung } : {}),
      ...(beisp ? { begruendungBeispiele: beisp } : {}),
    };
  };

  const positionen: Engine3Position[] = [];
  for (let i = 0; i < posRaw.length; i++) {
    const pos = parsePos(posRaw[i], i + 1);
    if (!pos) return null;
    positionen.push(pos);
  }

  let hinweiseRaw: unknown = o.hinweise ?? o.hinweis ?? o.hints;
  if (typeof hinweiseRaw === "string") {
    try {
      hinweiseRaw = JSON.parse(hinweiseRaw.trim());
    } catch {
      hinweiseRaw = [];
    }
  }
  const hinweiseArr = Array.isArray(hinweiseRaw) ? hinweiseRaw : [];
  const hinweise: Engine3Hinweis[] = [];
  for (const h of hinweiseArr) {
    if (!h || typeof h !== "object" || Array.isArray(h)) continue;
    const hr = h as Record<string, unknown>;
    const schwere = normalizeHinweisSchwere(hr.schwere);
    if (!schwere) continue;
    let titel = typeof hr.titel === "string" ? hr.titel.trim() : "";
    let detail = typeof hr.detail === "string" ? hr.detail.trim() : "";
    if (!titel && detail) titel = "Hinweis";
    if (titel && !detail) detail = titel;
    if (!titel || !detail) continue;
    const betrifftPositionen = normalizeBetrifftPositionen(hr.betrifftPositionen);
    hinweise.push({
      schwere,
      titel,
      detail,
      ...(typeof hr.regelReferenz === "string" ? { regelReferenz: hr.regelReferenz } : {}),
      ...(betrifftPositionen?.length ? { betrifftPositionen } : {}),
    });
  }

  let optimierungen: Engine3Position[] | undefined;
  let optList = o.optimierungen ?? o.optimization;
  if (typeof optList === "string") {
    try {
      optList = JSON.parse(optList.trim());
    } catch {
      optList = undefined;
    }
  }
  if (optList && typeof optList === "object" && !Array.isArray(optList)) {
    optList = [optList];
  }
  if (Array.isArray(optList) && optList.length > 0) {
    optimierungen = [];
    for (let j = 0; j < optList.length; j++) {
      const pos = parsePos(optList[j], posRaw.length + j + 1);
      if (pos) optimierungen.push(pos);
    }
    if (optimierungen.length === 0) optimierungen = undefined;
  }

  const base: Engine3ResultData = {
    modus,
    klinischerKontext: klin,
    fachgebiet: fach,
    positionen: positionen.map(fixPosition),
    hinweise,
    ...(optimierungen?.length ? { optimierungen: optimierungen.map(fixPosition) } : {}),
    zusammenfassung: {
      geschaetzteSumme: 0,
      anzahlPositionen: 0,
      fehler: 0,
      warnungen: 0,
    },
    ...(typeof o.goaeStandHinweis === "string" ? { goaeStandHinweis: o.goaeStandHinweis } : {}),
    ...(Array.isArray(o.adminQuellen) &&
        o.adminQuellen.every((x): x is string => typeof x === "string")
      ? { adminQuellen: o.adminQuellen }
      : {}),
  };
  base.zusammenfassung = summarize(base);
  return base;
}

export function applyRecalcAndConsistency(data: Engine3ResultData): Engine3ResultData {
  const positionen = data.positionen.map(fixPosition);
  const optimierungen = data.optimierungen?.map(fixPosition);
  const next: Engine3ResultData = {
    ...data,
    positionen,
    ...(optimierungen?.length ? { optimierungen } : {}),
  };
  next.zusammenfassung = summarize(next);
  return next;
}

function enrichPositionBegruendungBeispiele(p: Engine3Position): Engine3Position {
  const canonical = getBegruendungBeispiele(p.ziffer, p.faktor, {
    quelleText: p.quelleText,
    begruendung: p.begruendung,
    anmerkung: p.anmerkung,
  });
  if (canonical.length > 0) return { ...p, begruendungBeispiele: canonical };
  return p;
}

/** Deterministische Vorlagen für bekannte Ziffern; sonst unverändert (ggf. LLM-Array aus dem Parse). */
export function enrichEngine3BegruendungBeispiele(data: Engine3ResultData): Engine3ResultData {
  return {
    ...data,
    positionen: data.positionen.map(enrichPositionBegruendungBeispiele),
    ...(data.optimierungen?.length
      ? { optimierungen: data.optimierungen.map(enrichPositionBegruendungBeispiele) }
      : {}),
  };
}

/**
 * Welche der beiden Positionen entfällt bei Ausschlusskonflikt (gleiche Logik wie `nrBeiAusschlussZuStreichen` in regelengine).
 * @returns `true` = zweites Argument streichen, `false` = erstes streichen.
 */
function engine3StrikeSecondInPair(a: Engine3Position, b: Engine3Position): boolean {
  if (a.betrag !== b.betrag) {
    return a.betrag >= b.betrag;
  }
  const zifferPunkteKey = (z: string): number => {
    const digits = z.replace(/^A/i, "").replace(/\D/g, "");
    const n = parseInt(digits || "0", 10);
    return Number.isNaN(n) ? 0 : n;
  };
  const ka = zifferPunkteKey(a.ziffer);
  const kb = zifferPunkteKey(b.ziffer);
  if (ka !== kb) return ka >= kb;
  return a.nr <= b.nr;
}

/**
 * Paarweise Ausschlussprüfung gegen den kanonischen Regelkatalog (wie Regelengine, ohne LLM).
 * Kollidierende Positionen werden bis zur Konfliktfreiheit auf **eine** reduziert (entfallende Zeile entfernen);
 * ein Hinweis dokumentiert die Streichung. Weitere GOÄ-Prüfungen gehören hierher statt ins LLM.
 */
export function applyEngine3AusschlussPass(data: Engine3ResultData): Engine3ResultData {
  const katalog = getRegelKatalog();
  type Row = { ziffer: string; list: "pos" | "opt"; idx: number };

  let working: Engine3ResultData = data;
  const neueHinweise: Engine3Hinweis[] = [];
  let changed = false;

  while (true) {
    const rows: Row[] = [];
    working.positionen.forEach((p, idx) => {
      const z = normZiffer(p.ziffer);
      if (z && z !== "?" && katalog.has(z)) rows.push({ ziffer: z, list: "pos", idx });
    });
    (working.optimierungen ?? []).forEach((p, idx) => {
      const z = normZiffer(p.ziffer);
      if (z && z !== "?" && katalog.has(z)) rows.push({ ziffer: z, list: "opt", idx });
    });

    let bi = -1;
    let bj = -1;
    outer: for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (!regelZiffernKollidieren(katalog, rows[i].ziffer, rows[j].ziffer)) continue;
        bi = i;
        bj = j;
        break outer;
      }
    }

    if (bi < 0) break;

    const ri = rows[bi];
    const rj = rows[bj];
    const pi = ri.list === "pos" ? working.positionen[ri.idx] : (working.optimierungen ?? [])[ri.idx]!;
    const pj = rj.list === "pos" ? working.positionen[rj.idx] : (working.optimierungen ?? [])[rj.idx]!;
    const strikeSecond = engine3StrikeSecondInPair(pi, pj);
    const loseRow = strikeSecond ? rj : ri;

    const za = ri.ziffer < rj.ziffer ? ri.ziffer : rj.ziffer;
    const zb = ri.ziffer < rj.ziffer ? rj.ziffer : ri.ziffer;
    const titel = `Ausschluss: GOÄ ${za} / ${zb}`;
    const hasHint =
      working.hinweise.some((h) => h.titel === titel) || neueHinweise.some((h) => h.titel === titel);

    if (!hasHint) {
      const ea = katalog.get(za);
      const eb = katalog.get(zb);
      const removedP = strikeSecond ? pj : pi;
      const removedZ = strikeSecond ? rj.ziffer : ri.ziffer;
      const schwere: Engine3Hinweis["schwere"] =
        working.modus === "rechnung_pruefung" ? "fehler" : "warnung";
      const detail =
        `Laut Katalogausschluss sind GOÄ ${za} (${ea?.bezeichnung ?? "—"}) und GOÄ ${zb} (${eb?.bezeichnung ?? "—"}) in einem Abrechnungsfall nicht nebeneinander berechnungsfähig. ` +
        `GOÄ ${removedZ} (${removedP.bezeichnung.trim() || "—"}) wurde für die Darstellung gestrichen (Priorität wie bei der Summenkorrektur: niedrigerer Betrag, sonst höhere GOÄ-Ziffer, sonst höhere Positionsnummer).`;
      neueHinweise.push({
        schwere,
        titel,
        detail,
        regelReferenz: "Ausschlussziffern GOÄ-Katalog",
        betrifftPositionen: [pi.nr, pj.nr],
      });
    }

    if (loseRow.list === "pos") {
      working = {
        ...working,
        positionen: working.positionen.filter((_, idx) => idx !== loseRow.idx),
      };
    } else {
      const opts = [...(working.optimierungen ?? [])];
      opts.splice(loseRow.idx, 1);
      working = {
        ...working,
        optimierungen: opts.length ? opts : undefined,
      };
    }
    working = applyRecalcAndConsistency(working);
    changed = true;
  }

  if (!changed) return data;

  return applyRecalcAndConsistency({
    ...working,
    hinweise: [...working.hinweise, ...neueHinweise],
  });
}

function isQuelleTextMissing(s: string | undefined): boolean {
  const t = (s ?? "").trim();
  if (t.length < 2) return true;
  const lower = t.toLowerCase();
  if (/^(n\/?a|keine|keiner|-+|—+|\.{2,}|…+)$/i.test(lower)) return true;
  return false;
}

function syntheticQuelleForPosition(p: Engine3Position, modus: Engine3Modus): string {
  const entry = katalogEintrag(p.ziffer);
  const bez = (entry?.bezeichnung ?? p.bezeichnung ?? "").trim().slice(0, 120);
  const z = normZiffer(p.ziffer);
  if (modus === "rechnung_pruefung") {
    return `GOÄ-Katalog (Auszug): ${z}${bez ? ` — ${bez}` : ""}; kein Rechnungs-/Aktenbezug im Modell-JSON (systemseitig ergänzt).`;
  }
  return `GOÄ-Katalog (Auszug): ${z}${bez ? ` — ${bez}` : ""}; kein Dokument-/Freitextbezug im Modell-JSON (systemseitig ergänzt).`;
}

const NOTE_QUELLE_SYNTH =
  "Hinweis: quelleText fehlte oder war unbrauchbar; Katalogbezug vom System gesetzt — Eingabe bitte prüfen.";

function enforceQuelleOnPosition(p: Engine3Position, modus: Engine3Modus): Engine3Position {
  if (!isQuelleTextMissing(p.quelleText)) return p;
  const quelleText = syntheticQuelleForPosition(p, modus);
  const prevNote = (p.anmerkung ?? "").trim();
  const anmerkung = prevNote ? `${prevNote} ${NOTE_QUELLE_SYNTH}` : NOTE_QUELLE_SYNTH;
  if (p.status === "korrekt") {
    return { ...p, quelleText, status: "warnung", anmerkung };
  }
  return { ...p, quelleText, anmerkung };
}

/** Jede Position braucht einen nachvollziehbaren Quellenbezug (Katalog/Eingabe); Lücken werden deterministisch geschlossen. */
export function enforceEngine3Quellenbezug(data: Engine3ResultData): Engine3ResultData {
  const positionen = data.positionen.map((p) => enforceQuelleOnPosition(p, data.modus));
  const optimierungen = data.optimierungen?.map((p) => enforceQuelleOnPosition(p, data.modus));
  const next: Engine3ResultData = {
    ...data,
    positionen,
    ...(optimierungen?.length ? { optimierungen } : {}),
  };
  next.zusammenfassung = summarize(next);
  return next;
}

function buildEngine3EvidenceCorpus(data: Engine3ResultData): string {
  const parts: string[] = [
    data.klinischerKontext,
    data.fachgebiet,
    ...data.positionen.flatMap((p) => [p.bezeichnung, p.anmerkung, p.begruendung, p.quelleText]),
    ...(data.optimierungen ?? []).flatMap((p) => [p.bezeichnung, p.anmerkung, p.begruendung, p.quelleText]),
    ...data.hinweise.flatMap((h) => [h.titel, h.detail, h.regelReferenz ?? ""]),
  ];
  return parts
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join("\n")
    .toLowerCase();
}

function adminQuelleStemInCorpus(name: string, corpus: string): boolean {
  const low = name.trim().toLowerCase();
  if (!low) return false;
  if (corpus.includes(low)) return true;
  const stem = low.replace(/\.[a-z]{2,5}$/i, "").trim();
  if (stem.length < 6) return false;
  if (corpus.includes(stem)) return true;
  if (stem.length > 12) {
    const probe = stem.slice(0, 48);
    if (probe.length >= 12 && corpus.includes(probe)) return true;
  }
  return false;
}

/**
 * Entfernt Einträge aus `adminQuellen`, die im erzeugten JSON nicht vorkommen
 * (nur im Prompt gelieferte RAG-Dateien sollen nicht als „Quelle“ erscheinen).
 */
export function filterEngine3AdminQuellenToEvidence(data: Engine3ResultData): Engine3ResultData {
  const raw = data.adminQuellen;
  if (!raw?.length) return data;
  const corpus = buildEngine3EvidenceCorpus(data);
  const kept = raw.filter((a) => adminQuelleStemInCorpus(String(a), corpus));
  if (kept.length === raw.length) return data;
  return { ...data, adminQuellen: kept.length ? kept : undefined };
}

const SYNTH_RATIONALE_REF = "DocBill:SyntheticRationaleTemplate";
/** Mindestlänge zusammengefasster Begründungstext (Position + zugeordnete Hinweise). */
const MIN_RATIONALE_CHARS = 120;

function combinedRationaleLength(hinweise: Engine3Hinweis[], p: Engine3Position): number {
  const posPart = [p.begruendung, p.anmerkung].filter(Boolean).join(" ").trim();
  const fromH = hinweise
    .filter((h) => h.betrifftPositionen?.includes(p.nr))
    .map((h) => `${h.titel} ${h.detail}`)
    .join(" ")
    .trim();
  return `${posPart} ${fromH}`.trim().length;
}

/**
 * Stellt sicher, dass jede Position mit warnung/fehler genug erklärenden Text für die UI hat.
 * Ergänzt deterministisch einen Hinweis mit übernehmbaren Formulierungsvorschlägen, falls das Modell zu knapp war.
 */
export function ensureWarnungFehlerHaveUIFacingRationale(data: Engine3ResultData): Engine3ResultData {
  let hinweise = [...data.hinweise];
  const allRows: Engine3Position[] = [...data.positionen, ...(data.optimierungen ?? [])];

  for (const p of allRows) {
    if (p.status !== "warnung" && p.status !== "fehler") continue;
    if (combinedRationaleLength(hinweise, p) >= MIN_RATIONALE_CHARS) continue;
    if (hinweise.some((h) => h.regelReferenz === SYNTH_RATIONALE_REF && h.betrifftPositionen?.includes(p.nr))) {
      continue;
    }

    const f = String(p.faktor).replace(".", ",");
    const euro = `${p.betrag.toFixed(2).replace(".", ",")} €`;
    const bez = (p.bezeichnung ?? "").trim();
    const q = (p.quelleText ?? "").trim().slice(0, 220);
    const detail =
      `Formulierungsvorschläge (zutreffende Teile direkt in die Patientendokumentation übernehmen, Rest anpassen oder streichen):\n\n` +
      `(1) Zur Leistung GOÄ ${p.ziffer} «${bez}» (Pos. ${p.nr}): Faktor ${f}, Betrag ${euro}. ` +
      `Dokumentieren Sie Indikation, Umfang und zeitlichen Ablauf der erbrachten Leistung im Rahmen der vorliegenden Befunde und des Abrechnungsfalls.\n\n` +
      `(2) Abrechnungshinweis: Die Bewertung erfolgt unter Berücksichtigung der GOÄ; bei parallelen Ziffern oder Mehrfachleistungen dokumentieren Sie die medizinische Notwendigkeit je Sitzung bzw. je erbrachter Leistung.\n\n` +
      (q
        ? `(3) Bezug aus der zugrundeliegenden Angabe: ${q}\n\n`
        : "") +
      `Hinweis: Diese Sätze sind Entwürfe ohne individuelle Diagnosestellung; vor der Aktennotiz medizinisch-juristisch prüfen.`;

    hinweise.push({
      schwere: p.status === "fehler" ? "fehler" : "warnung",
      titel: `Begründung / Aktennotiz zu Pos. ${p.nr} (GOÄ ${p.ziffer})`,
      detail,
      regelReferenz: SYNTH_RATIONALE_REF,
      betrifftPositionen: [p.nr],
    });
  }

  if (hinweise.length === data.hinweise.length) return data;
  return applyRecalcAndConsistency({
    ...data,
    hinweise,
  });
}
