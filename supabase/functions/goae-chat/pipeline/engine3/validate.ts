/**
 * Engine 3: JSON validieren, Beträge aus GOÄ-Punkten nachrechnen.
 */

import {
  buildRegelKatalogMapFromJson,
  goaeByZiffer,
  regelZiffernKollidieren,
  type RegelKatalogEintrag,
} from "../../goae-catalog-json.ts";

let _regelKatalog: Map<string, RegelKatalogEintrag> | null = null;
function getRegelKatalog(): Map<string, RegelKatalogEintrag> {
  if (!_regelKatalog) _regelKatalog = buildRegelKatalogMapFromJson();
  return _regelKatalog;
}

const PUNKTWERT = 0.0582873;

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
}

export interface Engine3Hinweis {
  schwere: "fehler" | "warnung" | "info";
  titel: string;
  detail: string;
  regelReferenz?: string;
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

/** SSE / Client: ohne Quellen-Metadaten, ohne Positions-Zusatzfelder; nur Fehler-/Warn-Hinweise. */
export interface Engine3ClientPosition {
  nr: number;
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  status: Engine3PositionStatus;
}

export interface Engine3ClientHinweis {
  schwere: "fehler" | "warnung" | "info";
  titel: string;
  detail: string;
}

export interface Engine3ClientResultData {
  modus: Engine3Modus;
  klinischerKontext: string;
  fachgebiet: string;
  positionen: Engine3ClientPosition[];
  hinweise: Engine3ClientHinweis[];
  optimierungen?: Engine3ClientPosition[];
  zusammenfassung: Engine3Summary;
}

export function toClientEngine3Result(data: Engine3ResultData): Engine3ClientResultData {
  const slimPos = (p: Engine3Position): Engine3ClientPosition => ({
    nr: p.nr,
    ziffer: p.ziffer,
    bezeichnung: p.bezeichnung,
    faktor: p.faktor,
    betrag: p.betrag,
    status: p.status,
  });
  const hinweise = data.hinweise
    .filter((h) => h.schwere === "fehler" || h.schwere === "warnung")
    .map((h) => ({ schwere: h.schwere, titel: h.titel, detail: h.detail }));
  const optimierungen = data.optimierungen?.map(slimPos);
  return {
    modus: data.modus,
    klinischerKontext: data.klinischerKontext,
    fachgebiet: data.fachgebiet,
    positionen: data.positionen.map(slimPos),
    hinweise,
    ...(optimierungen?.length ? { optimierungen } : {}),
    zusammenfassung: data.zusammenfassung,
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
    hinweise.push({
      schwere,
      titel,
      detail,
      ...(typeof hr.regelReferenz === "string" ? { regelReferenz: hr.regelReferenz } : {}),
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

/**
 * Paarweise Ausschlussprüfung gegen den kanonischen Regelkatalog (wie Regelengine, ohne LLM).
 * Weitere eindeutige GOÄ-Prüfungen sollten ebenfalls hier oder in benachbarten Exporten aus
 * `applyRecalcAndConsistency`/`orchestrator` folgen (LLM nur für Interpretation, System für harte Regeln).
 */
export function applyEngine3AusschlussPass(data: Engine3ResultData): Engine3ResultData {
  const katalog = getRegelKatalog();
  type Row = { ziffer: string; list: "pos" | "opt"; idx: number };
  const rows: Row[] = [];

  data.positionen.forEach((p, idx) => {
    const z = normZiffer(p.ziffer);
    if (z && z !== "?" && katalog.has(z)) rows.push({ ziffer: z, list: "pos", idx });
  });
  (data.optimierungen ?? []).forEach((p, idx) => {
    const z = normZiffer(p.ziffer);
    if (z && z !== "?" && katalog.has(z)) rows.push({ ziffer: z, list: "opt", idx });
  });

  const pairSeen = new Set<string>();
  const affected = new Set<string>();
  const neueHinweise: Engine3Hinweis[] = [];

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i].ziffer;
      const b = rows[j].ziffer;
      if (!regelZiffernKollidieren(katalog, a, b)) continue;
      const pKey = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (pairSeen.has(pKey)) continue;
      pairSeen.add(pKey);

      const ea = katalog.get(a);
      const eb = katalog.get(b);
      const titel = `Ausschluss: GOÄ ${a} / ${b}`;
      if (data.hinweise.some((h) => h.titel === titel)) continue;
      if (neueHinweise.some((h) => h.titel === titel)) continue;

      const schwere: Engine3Hinweis["schwere"] =
        data.modus === "rechnung_pruefung" ? "fehler" : "warnung";
      const detail =
        `Laut Katalogausschluss sind GOÄ ${a} (${ea?.bezeichnung ?? "—"}) und GOÄ ${b} (${eb?.bezeichnung ?? "—"}) in einem Abrechnungsfall nicht nebeneinander berechnungsfähig. Eine Position sollte entfallen oder der Abrechnungszeitraum/-kontext muss geklärt werden.`;
      neueHinweise.push({
        schwere,
        titel,
        detail,
        regelReferenz: "Ausschlussziffern GOÄ-Katalog",
      });
      affected.add(`${rows[i].list}:${rows[i].idx}`);
      affected.add(`${rows[j].list}:${rows[j].idx}`);
    }
  }

  if (neueHinweise.length === 0) return data;

  const escalatePosition = (p: Engine3Position): Engine3Position => {
    const target: Engine3PositionStatus = data.modus === "rechnung_pruefung" ? "fehler" : "warnung";
    const note = "Ausschlusskonflikt mit anderer Position.";
    if (p.status === "vorschlag") {
      return { ...p, status: "warnung", anmerkung: appendAnmerkung(p.anmerkung, note) };
    }
    if (p.status === "korrekt") {
      return { ...p, status: target, anmerkung: appendAnmerkung(p.anmerkung, note) };
    }
    if (p.status === "warnung" && target === "fehler") {
      return { ...p, status: "fehler", anmerkung: appendAnmerkung(p.anmerkung, note) };
    }
    return { ...p, anmerkung: appendAnmerkung(p.anmerkung, note) };
  };

  const positionen = data.positionen.map((p, idx) =>
    affected.has(`pos:${idx}`) ? escalatePosition(p) : p,
  );
  const optimierungen = data.optimierungen?.map((p, idx) =>
    affected.has(`opt:${idx}`) ? escalatePosition(p) : p,
  );

  const mergedHinweise = [...data.hinweise, ...neueHinweise];
  const withHints: Engine3ResultData = {
    ...data,
    positionen,
    ...(optimierungen?.length ? { optimierungen } : {}),
    hinweise: mergedHinweise,
  };
  withHints.zusammenfassung = summarize(withHints);
  return applyRecalcAndConsistency(withHints);
}

function appendAnmerkung(prev: string | undefined, add: string): string {
  const t = (prev ?? "").trim();
  return t ? `${t} ${add}` : add;
}
