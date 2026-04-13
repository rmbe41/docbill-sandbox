/**
 * Engine-3-Ergebnis (schlanke Server-Payload aus `engine3_result` SSE).
 * Ältere gespeicherte Nachrichten können Zusatzfelder enthalten (Parser tolerant).
 */

import { getBegruendungBeispiele } from "@/lib/goae-begruendung-beispiele";

export type Engine3Modus = "rechnung_pruefung" | "leistungen_abrechnen";

export type Engine3PositionStatus = "korrekt" | "warnung" | "fehler" | "vorschlag";

export interface Engine3Position {
  nr: number;
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  status: Engine3PositionStatus;
  /** Legacy / alte Server-Payloads */
  anmerkung?: string;
  quelleText?: string;
  begruendung?: string;
  /** Vollständige, wählbare Begründungsvarianten (Server/Client). */
  begruendungBeispiele?: string[];
}

export interface Engine3TopVorschlag extends Engine3Position {
  rang: 1 | 2 | 3;
  empfohlen?: boolean;
}

export interface Engine3Hinweis {
  schwere: "fehler" | "warnung" | "info";
  titel: string;
  detail: string;
  regelReferenz?: string;
  /** Positionsnummern (`nr`), optional – UI-Zuordnung zu Tabellenzeilen */
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
  topVorschlaege?: Engine3TopVorschlag[];
  zusammenfassung: Engine3Summary;
  /** Nur in älteren gespeicherten Antworten */
  goaeStandHinweis?: string;
  adminQuellen?: string[];
  quellen?: string[];
}

function coerceZiffer(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v).trim();
  return "";
}

function coerceDeNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return NaN;
  let t = v.trim().replace(/\s/g, "");
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

function normalizeStatus(st: unknown): Engine3PositionStatus | null {
  const s = String(st ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
  if (s === "korrekt" || s === "correct" || s === "ok") return "korrekt";
  if (s === "warnung" || s === "warning") return "warnung";
  if (s === "fehler" || s === "error") return "fehler";
  if (s === "vorschlag" || s === "suggestion") return "vorschlag";
  return null;
}

function normalizeSchwere(v: unknown): "fehler" | "warnung" | "info" | null {
  const s = String(v ?? "").toLowerCase().trim();
  if (s === "fehler" || s === "error") return "fehler";
  if (s === "warnung" || s === "warning") return "warnung";
  if (s === "info" || s === "information") return "info";
  return null;
}

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

function coerceCtxStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function normalizeBegruendungBeispieleArr(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 3);
  return out.length ? out : undefined;
}

function enrichPositionBegruendungBeispieleClient(p: Engine3Position): Engine3Position {
  const canonical = getBegruendungBeispiele(p.ziffer, p.faktor, {
    quelleText: p.quelleText,
    begruendung: p.begruendung,
    anmerkung: p.anmerkung,
  });
  if (canonical.length > 0) return { ...p, begruendungBeispiele: canonical };
  return p;
}

function unwrapEngine3Payload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const root = raw as Record<string, unknown>;
  const ok = (o: Record<string, unknown>) =>
    (o.modus === "rechnung_pruefung" || o.modus === "leistungen_abrechnen") && Array.isArray(o.positionen);
  if (ok(root)) return root;
  const queue: Record<string, unknown>[] = [root];
  const seen = new Set<unknown>();
  for (let i = 0; i < 80 && queue.length > 0; i++) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (ok(cur)) return cur;
    for (const k of Object.keys(cur)) {
      const inner = cur[k];
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        queue.push(inner as Record<string, unknown>);
      }
    }
  }
  return root;
}

function summarizeFromPositions(
  positionen: Engine3Position[],
  optimierungen: Engine3Position[] | undefined,
  hinweise: Engine3Hinweis[],
): Engine3Summary {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const all = [...positionen, ...(optimierungen ?? [])];
  const geschaetzteSumme = round2(all.reduce((s, p) => s + p.betrag, 0));
  const fehler =
    hinweise.filter((h) => h.schwere === "fehler").length +
    positionen.filter((p) => p.status === "fehler").length +
    (optimierungen?.filter((p) => p.status === "fehler").length ?? 0);
  const warnungen =
    hinweise.filter((h) => h.schwere === "warnung").length +
    positionen.filter((p) => p.status === "warnung").length +
    (optimierungen?.filter((p) => p.status === "warnung").length ?? 0);
  return {
    geschaetzteSumme,
    anzahlPositionen: positionen.length,
    fehler,
    warnungen,
  };
}

/** Minimaler Parser für Frontend (hart genug, um Müll abzuweisen). */
export function parseEngine3ResultData(raw: unknown): Engine3ResultData | null {
  const o = unwrapEngine3Payload(raw);
  if (!o) return null;
  const modus = o.modus;
  if (modus !== "rechnung_pruefung" && modus !== "leistungen_abrechnen") return null;
  const klinischerKontext = coerceCtxStr(o.klinischerKontext);
  const fachgebiet = coerceCtxStr(o.fachgebiet);
  const posRaw = o.positionen;
  if (!Array.isArray(posRaw)) return null;
  const positionen: Engine3Position[] = [];
  for (const p of posRaw) {
    if (!p || typeof p !== "object" || Array.isArray(p)) return null;
    const r = p as Record<string, unknown>;
    const nr = coerceDeNumber(r.nr);
    const ziffer = coerceZiffer(r.ziffer);
    const bezeichnung =
      typeof r.bezeichnung === "string"
        ? r.bezeichnung
        : typeof r.bezeichnung === "number" && Number.isFinite(r.bezeichnung)
          ? String(r.bezeichnung)
          : "";
    const faktor = coerceDeNumber(r.faktor);
    const betrag = coerceDeNumber(r.betrag);
    const st = normalizeStatus(r.status);
    if (!Number.isFinite(nr) || !ziffer || !Number.isFinite(faktor) || !Number.isFinite(betrag) || !st) {
      return null;
    }
    const beisp = normalizeBegruendungBeispieleArr(r.begruendungBeispiele);
    positionen.push({
      nr: Math.round(nr),
      ziffer,
      bezeichnung,
      faktor,
      betrag,
      status: st,
      ...(typeof r.anmerkung === "string" ? { anmerkung: r.anmerkung } : {}),
      ...(typeof r.quelleText === "string" ? { quelleText: r.quelleText } : {}),
      ...(typeof r.begruendung === "string" ? { begruendung: r.begruendung } : {}),
      ...(beisp ? { begruendungBeispiele: beisp } : {}),
    });
  }
  const hinweiseRaw = Array.isArray(o.hinweise) ? o.hinweise : [];
  const hinweise: Engine3Hinweis[] = [];
  for (const h of hinweiseRaw) {
    if (!h || typeof h !== "object" || Array.isArray(h)) continue;
    const hr = h as Record<string, unknown>;
    const schwere = normalizeSchwere(hr.schwere);
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
  if (o.optimierungen != null) {
    const optRaw = o.optimierungen;
    if (!Array.isArray(optRaw)) return null;
    optimierungen = [];
    for (const p of optRaw) {
      if (!p || typeof p !== "object" || Array.isArray(p)) return null;
      const r = p as Record<string, unknown>;
      const nr = coerceDeNumber(r.nr);
      const ziffer = coerceZiffer(r.ziffer);
      const bezeichnung =
        typeof r.bezeichnung === "string"
          ? r.bezeichnung
          : typeof r.bezeichnung === "number" && Number.isFinite(r.bezeichnung)
            ? String(r.bezeichnung)
            : "";
      const faktor = coerceDeNumber(r.faktor);
      const betrag = coerceDeNumber(r.betrag);
      const st = normalizeStatus(r.status);
      if (!Number.isFinite(nr) || !ziffer || !Number.isFinite(faktor) || !Number.isFinite(betrag) || !st) {
        return null;
      }
      const beispOpt = normalizeBegruendungBeispieleArr(r.begruendungBeispiele);
      optimierungen.push({
        nr: Math.round(nr),
        ziffer,
        bezeichnung,
        faktor,
        betrag,
        status: st,
        ...(typeof r.anmerkung === "string" ? { anmerkung: r.anmerkung } : {}),
        ...(typeof r.quelleText === "string" ? { quelleText: r.quelleText } : {}),
        ...(typeof r.begruendung === "string" ? { begruendung: r.begruendung } : {}),
        ...(beispOpt ? { begruendungBeispiele: beispOpt } : {}),
      });
    }
  }

  let topVorschlaege: Engine3TopVorschlag[] | undefined;
  if (o.topVorschlaege != null) {
    const topRaw = o.topVorschlaege;
    if (!Array.isArray(topRaw)) return null;
    topVorschlaege = [];
    for (const p of topRaw) {
      if (!p || typeof p !== "object" || Array.isArray(p)) return null;
      const r = p as Record<string, unknown>;
      const nr = coerceDeNumber(r.nr);
      const ziffer = coerceZiffer(r.ziffer);
      const bezeichnung =
        typeof r.bezeichnung === "string"
          ? r.bezeichnung
          : typeof r.bezeichnung === "number" && Number.isFinite(r.bezeichnung)
            ? String(r.bezeichnung)
            : "";
      const faktor = coerceDeNumber(r.faktor);
      const betrag = coerceDeNumber(r.betrag);
      const st = normalizeStatus(r.status);
      const rang = coerceDeNumber(r.rang);
      if (
        !Number.isFinite(nr) || !ziffer || !Number.isFinite(faktor) || !Number.isFinite(betrag) || !st ||
        !Number.isFinite(rang)
      ) {
        return null;
      }
      const rInt = Math.round(rang);
      if (rInt < 1 || rInt > 3) return null;
      const beispTop = normalizeBegruendungBeispieleArr(r.begruendungBeispiele);
      topVorschlaege.push({
        nr: Math.round(nr),
        ziffer,
        bezeichnung,
        faktor,
        betrag,
        status: st,
        rang: rInt as 1 | 2 | 3,
        ...(typeof r.empfohlen === "boolean" && r.empfohlen ? { empfohlen: true } : {}),
        ...(typeof r.anmerkung === "string" ? { anmerkung: r.anmerkung } : {}),
        ...(typeof r.quelleText === "string" ? { quelleText: r.quelleText } : {}),
        ...(typeof r.begruendung === "string" ? { begruendung: r.begruendung } : {}),
        ...(beispTop ? { begruendungBeispiele: beispTop } : {}),
      });
    }
  }

  const summ = o.zusammenfassung;
  let zusammenfassung: Engine3Summary;
  if (summ && typeof summ === "object" && !Array.isArray(summ)) {
    const s = summ as Record<string, unknown>;
    const geschaetzteSumme = coerceDeNumber(s.geschaetzteSumme);
    const anzahlPositionen = coerceDeNumber(s.anzahlPositionen);
    const fehler = coerceDeNumber(s.fehler);
    const warnungen = coerceDeNumber(s.warnungen);
    if (
      Number.isFinite(geschaetzteSumme) &&
      Number.isFinite(anzahlPositionen) &&
      Number.isFinite(fehler) &&
      Number.isFinite(warnungen)
    ) {
      zusammenfassung = {
        geschaetzteSumme,
        anzahlPositionen: Math.round(anzahlPositionen),
        fehler: Math.round(fehler),
        warnungen: Math.round(warnungen),
      };
    } else {
      zusammenfassung = summarizeFromPositions(positionen, optimierungen, hinweise);
    }
  } else {
    zusammenfassung = summarizeFromPositions(positionen, optimierungen, hinweise);
  }

  const posEnriched = positionen.map(enrichPositionBegruendungBeispieleClient);
  const optEnriched = optimierungen?.map(enrichPositionBegruendungBeispieleClient);
  const topEnriched = topVorschlaege?.map((t) => enrichPositionBegruendungBeispieleClient(t));

  return {
    modus,
    klinischerKontext,
    fachgebiet,
    positionen: posEnriched,
    hinweise,
    ...(optEnriched?.length ? { optimierungen: optEnriched } : {}),
    ...(topEnriched?.length ? { topVorschlaege: topEnriched } : {}),
    zusammenfassung,
    ...(typeof o.goaeStandHinweis === "string" ? { goaeStandHinweis: o.goaeStandHinweis } : {}),
    ...(Array.isArray(o.adminQuellen) &&
    o.adminQuellen.every((x): x is string => typeof x === "string")
      ? { adminQuellen: o.adminQuellen }
      : {}),
    ...(Array.isArray(o.quellen) &&
    o.quellen.length > 0 &&
    o.quellen.every((x): x is string => typeof x === "string")
      ? { quellen: o.quellen }
      : {}),
  };
}
