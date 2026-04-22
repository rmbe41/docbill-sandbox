import type { Json } from "@/integrations/supabase/types";
import type { KennzeichnungStufe } from "@/lib/analyse/types";
import { kennFromLegacyPill } from "@/lib/batches/batchKennzeichnungDisplay";

/** Spec 03 §5.1 — Batch (UI/Domain; DB-Spalten gemappt in Hooks) */
export interface Batch {
  id: string;
  name: string;
  organisationId: string;
  erstelltVon: string;
  erstelltAm: string;
  aktualisiertAm: string;
  /** Anzahl Fälle (Patientenkontexte); `rechnungenCount` = Unterlagen. */
  faelleCount: number;
  rechnungenCount: number;
  verarbeitetCount: number;
  status: "processing" | "complete" | "partial";
  zusammenfassung: {
    gesamtbetrag: number;
    geprueft: number;
    mitHinweisen: number;
    mitFehlern: number;
    offen: number;
    optimierungspotenzial: number;
  };
}

/** Ein Fall im Stapel (eine oder mehrere Unterlagen). */
export interface BatchFall {
  id: string;
  batchId: string;
  sortOrder: number;
  label: string;
}

export type BatchListeStatus = "geprueft" | "mit_hinweisen" | "fehler" | "offen";

/** Stufen 02 §4.5, Anzeigetext variiert (z. B. UNVOLLSTÄNDIG → „Pflicht fehlt“) */
export type BatchPositionPill =
  | "Sicher"
  | "Prüfen"
  | "Pflicht fehlt"
  | "Optimierung"
  | "Risiko"
  | "Fehler";

export type BatchKpi = {
  hinweisGesamt: number;
  pruefen: number;
  risiko: number;
  optimierung: number;
  fehler: number;
  unvollstaendig: number;
};

export type BatchRechnungDetail = {
  fachbereich?: string;
  positionen: Array<{
    nr: number;
    ziffer?: string;
    faktor?: number;
    betrag?: number;
    fehlend?: boolean;
    pill: BatchPositionPill;
    kennzeichnung?: KennzeichnungStufe;
    titel?: string;
    text?: string;
    hinweis?: string;
  }>;
  gesamt: number;
  gesamtNach?: number;
  deltaLabel?: string;
  kpi?: BatchKpi;
  /** Rohdaten + Quelle (Verarbeitungsschritt) */
  metadata?: {
    rohText?: string;
    fileName?: string;
    quelle?: "pdf" | "pad" | "bild";
    pending?: boolean;
  };
};

export type BatchRechnungRow = {
  id: string;
  batchId: string;
  fallId: string;
  sortOrder: number;
  patientIdLabel: string;
  betragEuro: number;
  listeStatus: BatchListeStatus;
  hinweiseKurz: string | null;
  fachbereich: string | null;
  detail: BatchRechnungDetail;
  vorschlaegeAngenommen: boolean;
  aenderungenAnzahl: number;
  optimierungAngewendetEuro: number;
};

export function parseZusammenfassung(raw: Json | undefined): Batch["zusammenfassung"] {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const n = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k] as number) ? (o[k] as number) : 0);
  return {
    gesamtbetrag: n("gesamtbetrag"),
    geprueft: n("geprueft"),
    mitHinweisen: n("mitHinweisen"),
    mitFehlern: n("mitFehlern"),
    offen: n("offen"),
    optimierungspotenzial: n("optimierungspotenzial"),
  };
}

function normalizePositionen(pos: BatchRechnungDetail["positionen"]): BatchRechnungDetail["positionen"] {
  return pos.map((p) => ({
    ...p,
    kennzeichnung: p.kennzeichnung ?? kennFromLegacyPill(p.pill),
  }));
}

function parseKpi(o: Record<string, unknown>): BatchKpi | undefined {
  const k = o.kpi;
  if (!k || typeof k !== "object" || Array.isArray(k)) return undefined;
  const r = k as Record<string, unknown>;
  const n = (key: string) => (typeof r[key] === "number" && Number.isFinite(r[key] as number) ? (r[key] as number) : 0);
  return {
    hinweisGesamt: n("hinweisGesamt"),
    pruefen: n("pruefen"),
    risiko: n("risiko"),
    optimierung: n("optimierung"),
    fehler: n("fehler"),
    unvollstaendig: n("unvollstaendig"),
  };
}

function parseMetadata(o: Record<string, unknown>): BatchRechnungDetail["metadata"] | undefined {
  const m = o.metadata;
  if (!m || typeof m !== "object" || Array.isArray(m)) return undefined;
  const r = m as Record<string, unknown>;
  return {
    rohText: typeof r.rohText === "string" ? r.rohText : undefined,
    fileName: typeof r.fileName === "string" ? r.fileName : undefined,
    quelle: r.quelle === "pdf" || r.quelle === "pad" || r.quelle === "bild" ? r.quelle : undefined,
    pending: typeof r.pending === "boolean" ? r.pending : undefined,
  };
}

export function parseDetailJson(raw: Json | undefined): BatchRechnungDetail {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { positionen: [], gesamt: 0 };
  }
  const o = raw as Record<string, unknown>;
  const posRaw = o.positionen;
  const positionen = Array.isArray(posRaw)
    ? normalizePositionen(
        posRaw.filter((x) => x && typeof x === "object") as BatchRechnungDetail["positionen"],
      )
    : [];
  return {
    fachbereich: typeof o.fachbereich === "string" ? o.fachbereich : undefined,
    positionen,
    gesamt: typeof o.gesamt === "number" ? o.gesamt : 0,
    gesamtNach: typeof o.gesamtNach === "number" ? o.gesamtNach : undefined,
    deltaLabel: typeof o.deltaLabel === "string" ? o.deltaLabel : undefined,
    kpi: parseKpi(o),
    metadata: parseMetadata(o),
  };
}
