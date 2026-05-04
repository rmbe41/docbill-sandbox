import ebmCatalogJson from "@/data/ebm-catalog-2026-q2.json" with { type: "json" };
import { goaeV2CodeById, isGoaeV2CodeExcluded } from "@/data/goae-catalog-v2";
import type { ServiceItemEbm, ServiceItemGoae } from "./types";

/** Wie GOÄ-Regelengine (`supabase/functions/goae-chat/pipeline/regelengine.ts`) — nicht mit EBM-Orientierungswert verwechseln */
export const GOAE_PUNKTWERT = 0.0582873;

export const r2 = (x: number) => Math.round(x * 100) / 100;

type EbmGopRow = {
  gop: string;
  bezeichnung: string;
  punktzahl: number;
  euroWert: number;
};

const DB = ebmCatalogJson as { orientierungswert?: number; gops: EbmGopRow[] };

export const ebmPositionByGop = new Map<string, EbmGopRow>(DB.gops.map((g) => [g.gop, g]));

const EBM_ORIENTIERUNGSWERT = DB.orientierungswert ?? 0;

/**
 * Einige GOP-Zeilen haben in der PDF-Extraktion 0 € ohne Punktzahl; für die Sandbox nutzen wir
 * dokumentierte Orientierungsbeträge (€), damit die Demo strukturell KBV-/Engine-nah bleibt.
 */
const EBM_SANDBOX_FALLBACK_EURO: Record<string, number> = {
  /** Zuschlag augenärztliche Grundversorgung — Extrakt ohne €/Pkt.; Demo wie Engine-Summenbildung */
  "06220": 2.68,
};

/** Aufsteigend € – für kleine „Lücken“ bei EBM-Summenziel */
export const SANDBOX_EBM_FILLERS_ASC: readonly EbmGopRow[] = [...DB.gops]
  .filter((g) => g.euroWert >= 0.15 && g.euroWert <= 980)
  .sort((a, b) => a.euroWert - b.euroWert || a.gop.localeCompare(b.gop));

/** Absteigend € – grobe Schritte Richtung Zielsumme */
export const SANDBOX_EBM_FILLERS_DESC = [...SANDBOX_EBM_FILLERS_ASC].slice().reverse();

const EPS = 0.015;

/** Katalog-Ziffern mit vergleichbarem Höchstsatz zum „Auffüllen“ der Sandbox-GOÄ-Summe Richtung Zielbetrag (wie EBM-Filler). */
function buildSandboxGoaeFillerCodesDesc(): string[] {
  return [...goaeV2CodeById.values()]
    .filter(
      (c) =>
        c.status === "active" &&
        c.fee.points > 0 &&
        c.fee.maxAmount >= 5 &&
        c.fee.maxAmount <= 530,
    )
    .sort((a, b) => b.fee.maxAmount - a.fee.maxAmount || a.code.localeCompare(b.code))
    .slice(0, 550)
    .map((c) => c.code);
}

const SANDBOX_GOAE_FILLERS_DESC: readonly string[] = buildSandboxGoaeFillerCodesDesc();
const SANDBOX_GOAE_FILLERS_ASC: readonly string[] = [...SANDBOX_GOAE_FILLERS_DESC].slice().reverse();

export function unitEbmEuroFromCatalogRow(row: EbmGopRow): number | null {
  if (row.euroWert > 0) return r2(row.euroWert);
  if (row.punktzahl > 0 && EBM_ORIENTIERUNGSWERT > 0) {
    return r2((row.punktzahl * EBM_ORIENTIERUNGSWERT) / 100);
  }
  const fb = EBM_SANDBOX_FALLBACK_EURO[row.gop];
  if (fb != null && fb > 0) return r2(fb);
  return null;
}

export function sumEbm(items: readonly ServiceItemEbm[]): number {
  return r2(items.reduce((s, x) => s + (x.amount_eur ?? 0), 0));
}

export function sumGoae(items: readonly ServiceItemGoae[]): number {
  return r2(items.reduce((s, x) => s + x.amount, 0));
}

export function serviceItemEbm(
  gop: string,
  options?: { quantity?: number },
): ServiceItemEbm | null {
  const row = ebmPositionByGop.get(gop);
  if (!row) return null;
  const unit = unitEbmEuroFromCatalogRow(row);
  if (unit == null || unit <= 0) return null;
  const quantity = Math.max(1, options?.quantity ?? 1);
  const amount_eur = r2(unit * quantity);
  return {
    code: row.gop,
    label: row.bezeichnung.trim() || row.gop,
    points: row.punktzahl,
    amount_eur,
    ...(quantity > 1 ? { quantity } : {}),
  };
}

/** Reihenfolge wie typische KV-Liste: 062…-Paket zuerst, danach 063…-Erweiterungen, dann Briefe 016…. */
export function finalizeEbmSandboxLines(seedItems: readonly ServiceItemEbm[]): ServiceItemEbm[] {
  const prefWeight = (code: string): number => {
    if (code.startsWith("062")) return 100;
    if (code.startsWith("063")) return 200;
    if (code.startsWith("064")) return 250;
    if (code.startsWith("016")) return 800;
    return 400;
  };
  return [...seedItems].sort(
    (a, b) => prefWeight(a.code) - prefWeight(b.code) || a.code.localeCompare(b.code),
  );
}

function bundleAlreadyHasEbmCode(bundle: readonly string[], code: string): boolean {
  return bundle.includes(code);
}

/** Zusatz-GOPs aus dem EBM-Katalog bis zur Ziel-Summe (wie GOÄ-Sandbox-Auffüller). */
function appendEbmLinesTowardTarget(lines: readonly ServiceItemEbm[], targetEuro: number): ServiceItemEbm[] {
  type MutableEbm = ServiceItemEbm;
  const out: MutableEbm[] = [...lines];
  let guard = 0;
  while (sumEbm(out) + EPS < targetEuro && guard++ < 9000) {
    const rem = targetEuro - sumEbm(out);
    const bundle = out.map((w) => w.code);
    let bestFit: ServiceItemEbm | null = null;
    for (const row of SANDBOX_EBM_FILLERS_DESC) {
      if (bundleAlreadyHasEbmCode(bundle, row.gop)) continue;
      const item = serviceItemEbm(row.gop);
      if (!item || (item.amount_eur ?? 0) > rem + EPS) continue;
      if (!bestFit || (item.amount_eur ?? 0) > (bestFit.amount_eur ?? 0)) bestFit = item;
    }
    if (bestFit) {
      out.push(bestFit);
      continue;
    }
    let smallest: ServiceItemEbm | null = null;
    for (const row of SANDBOX_EBM_FILLERS_ASC) {
      if (bundleAlreadyHasEbmCode(bundle, row.gop)) continue;
      const item = serviceItemEbm(row.gop);
      if (!item) continue;
      if (!smallest || (item.amount_eur ?? 0) < (smallest.amount_eur ?? 0)) smallest = item;
    }
    if (!smallest) break;
    out.push(smallest);
  }
  return out;
}

/** Erhöht Mengen auf bereits geführten Zeilen, um Lücken bis ~Ziel zu schließen (nur wo Einheit passt). */
function bumpEbmQuantitiesTowardTarget(lines: ServiceItemEbm[], targetEuro: number): void {
  let guard = 0;
  while (sumEbm(lines) + EPS < targetEuro && guard++ < 2000) {
    const rem = targetEuro - sumEbm(lines);
    let bestIdx = -1;
    let bestUnit = Infinity;
    for (let j = 0; j < lines.length; j++) {
      const L = lines[j]!;
      const q0 = L.quantity ?? 1;
      const unit = q0 > 0 ? r2((L.amount_eur ?? 0) / q0) : 0;
      if (unit <= 0 || unit > rem + EPS) continue;
      if (unit < bestUnit) {
        bestUnit = unit;
        bestIdx = j;
      }
    }
    if (bestIdx < 0) break;
    const L = lines[bestIdx]!;
    const q = (L.quantity ?? 1) + 1;
    const unit = r2((L.amount_eur ?? 0) / (L.quantity ?? 1));
    lines[bestIdx] = { ...L, quantity: q, amount_eur: r2(unit * q) };
  }
}

/**
 * EBM: Seed-/Engine-Zeilen sortiert lassen und mit Katalog-Fillern zur Sandbox-Zielsumme auffüllen
 * (GKV sieht damit ähnliche Breite wie GOÄ/PKV).
 */
export function finalizeEbmToTarget(seedItems: readonly ServiceItemEbm[], targetEuro: number): ServiceItemEbm[] {
  const sorted = finalizeEbmSandboxLines([...seedItems]);
  const merged = appendEbmLinesTowardTarget(sorted, targetEuro);
  bumpEbmQuantitiesTowardTarget(merged, targetEuro);
  return finalizeEbmSandboxLines(merged);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Sandbox: Begründungspflicht ab Steigerung über max(Regelhöchstfaktor, 2,3) — typisch GOÄ / Demo-Klarheit */
export function goaeFactorRequiresJustification(code: string, factor: number): boolean {
  const row = goaeV2CodeById.get(code);
  const th = row?.fee.thresholdFactor ?? 2.3;
  const effective = Math.max(th, 2.3);
  return factor > effective + 0.009;
}

/** Anzeige/Ergänzung: Begründungstext bei Faktor über Schwellwert (siehe `goaeFactorRequiresJustification`). */
export function effectiveGoaeFactorJustification(code: string, factor: number, preferred?: string): string | undefined {
  if (!goaeFactorRequiresJustification(code, factor)) return undefined;
  const t = preferred?.trim();
  if (t) return t;
  const row = goaeV2CodeById.get(code);
  const th = row?.fee.thresholdFactor ?? 2.3;
  const refTh = Math.max(th, 2.3);
  const fs = r2(factor).toFixed(2).replace(".", ",");
  const ts = r2(refTh).toFixed(2).replace(".", ",");
  return `Steigerungsfaktor ${fs} über ${ts} (GOÄ Nr. ${code}): erhöhter Zeitaufwand und besondere Schwierigkeit.`;
}

function factorJustificationForLine(code: string, factor: number, preferred?: string): Pick<ServiceItemGoae, "factor_justification"> | object {
  const text = effectiveGoaeFactorJustification(code, factor, preferred);
  if (!text) return {};
  return { factor_justification: text };
}

export function serviceItemGoae(code: string, factor: number, factor_justification?: string): ServiceItemGoae | null {
  const row = goaeV2CodeById.get(code);
  if (!row?.fee.points) return null;
  const f = clamp(factor, row.fee.thresholdFactor, row.fee.maxFactor);
  return {
    code,
    label: row.title.trim() || row.code,
    factor: r2(f),
    amount: r2(row.fee.points * GOAE_PUNKTWERT * f),
    ...factorJustificationForLine(code, f, factor_justification),
  };
}

/** Betrag unter aktuellem Faktor aktualisieren (Katalog, gerundet); Begründung bleibt oder wird ergänzt */
export function withGoaeFactor(item: ServiceItemGoae, factor: number): ServiceItemGoae | null {
  const row = goaeV2CodeById.get(item.code);
  if (!row?.fee.points) return null;
  const f = clamp(factor, row.fee.thresholdFactor, row.fee.maxFactor);
  return {
    code: item.code,
    label: item.label,
    factor: r2(f),
    amount: r2(row.fee.points * GOAE_PUNKTWERT * f),
    ...factorJustificationForLine(item.code, f, item.factor_justification),
  };
}

function codesGoaeConflict(codes: readonly string[]): boolean {
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      if (isGoaeV2CodeExcluded(codes[i]!, codes[j]!)) return true;
    }
  }
  return false;
}

/** Ob `code` gegen keine bereits geführte Ziffer verstößt (für iterative Aufstockung ohne O(n²)-Retest). */
function bundleCompatibleWith(existingBundle: readonly string[], code: string): boolean {
  for (const b of existingBundle) {
    if (isGoaeV2CodeExcluded(b, code)) return false;
  }
  return true;
}

/** Sandbox-Demo: dieselbe GOÄ-Ziffer nicht mehrfach auf einer Rechnung (außer explizite Seed-/Engine-Zeilen mit eigener Semantik). */
function bundleAlreadyHasGoaeCode(bundle: readonly string[], code: string): boolean {
  return bundle.includes(code);
}

/** Zusatzpositionen aus dem GOÄ-Katalog bis zur Ziel-Summe (nach Faktor-Anpassungen). */
function appendGoaeLinesTowardTarget(lines: readonly ServiceItemGoae[], targetEuro: number): ServiceItemGoae[] {
  const out = [...lines];
  let guard = 0;
  while (sumGoae(out) + EPS < targetEuro && guard++ < 9000) {
    const rem = targetEuro - sumGoae(out);
    const bundle = out.map((w) => w.code);
    let bestFit: ServiceItemGoae | null = null;
    for (const code of SANDBOX_GOAE_FILLERS_DESC) {
      if (bundleAlreadyHasGoaeCode(bundle, code)) continue;
      if (!bundleCompatibleWith(bundle, code)) continue;
      const row = goaeV2CodeById.get(code);
      if (!row) continue;
      const item = serviceItemGoae(code, row.fee.maxFactor);
      if (!item || item.amount > rem + EPS) continue;
      if (!bestFit || item.amount > bestFit.amount) bestFit = item;
    }
    if (bestFit) {
      out.push(bestFit);
      continue;
    }
    let smallest: ServiceItemGoae | null = null;
    for (const code of SANDBOX_GOAE_FILLERS_ASC) {
      if (bundleAlreadyHasGoaeCode(bundle, code)) continue;
      if (!bundleCompatibleWith(bundle, code)) continue;
      const row = goaeV2CodeById.get(code);
      if (!row) continue;
      const item = serviceItemGoae(code, row.fee.thresholdFactor);
      if (!item) continue;
      if (!smallest || item.amount < smallest.amount) smallest = item;
    }
    if (!smallest) break;
    out.push(smallest);
  }
  return out;
}


/** GOÄ: Faktoren im Katalog-Intervall [Schwelle, Max] so anpassen, dass die Summe dem Ziel nahekommt; ggf. eine konfliktfreie Zusatzposition */
export function finalizeGoaeToTarget(seedItems: readonly ServiceItemGoae[], targetEuro: number): ServiceItemGoae[] {
  const working = seedItems.map((x) => ({ ...x }));
  if (working.length === 0) return working;

  for (let iter = 0; iter < 80; iter++) {
    const total = sumGoae(working);
    const diff = targetEuro - total;
    if (Math.abs(diff) < EPS) break;

    let bestJ = -1;
    let bestDeltaF = 0;
    for (let j = 0; j < working.length; j++) {
      const row = goaeV2CodeById.get(working[j]!.code);
      if (!row?.fee.points) continue;
      const k = row.fee.points * GOAE_PUNKTWERT;
      const lo = row.fee.thresholdFactor;
      const hi = row.fee.maxFactor;
      const cur = working[j]!.factor;
      let nextF = cur + diff / k;
      nextF = clamp(nextF, lo, hi);
      const df = nextF - cur;
      if (Math.abs(df) > Math.abs(bestDeltaF)) {
        bestDeltaF = df;
        bestJ = j;
      }
    }
    if (bestJ < 0 || Math.abs(bestDeltaF) < 1e-9) break;
    const u = withGoaeFactor(working[bestJ]!, working[bestJ]!.factor + bestDeltaF);
    if (!u) break;
    working[bestJ] = u;
  }

  /** Feinabrundung über die „stärkste“ Zeile (größter €/Einheit-Faktor) */
  let rowIdx = -1;
  let bestSens = 0;
  for (let j = 0; j < working.length; j++) {
    const row = goaeV2CodeById.get(working[j]!.code);
    if (!row?.fee.points) continue;
    const sens = row.fee.points * GOAE_PUNKTWERT;
    if (sens >= bestSens) {
      bestSens = sens;
      rowIdx = j;
    }
  }
  if (rowIdx >= 0) {
    const row = goaeV2CodeById.get(working[rowIdx]!.code)!;
    const k = row.fee.points * GOAE_PUNKTWERT;
    const sumElse = sumGoae(working) - working[rowIdx]!.amount;
    let wantF = (targetEuro - sumElse) / k;
    wantF = clamp(wantF, row.fee.thresholdFactor, row.fee.maxFactor);
    const adj = withGoaeFactor(working[rowIdx]!, wantF);
    if (adj) working[rowIdx] = adj;
  }

  const PAD_CODES = ["750", "250", "501", "600", "601", "602", "617", "618", "485", "440"] as const;
  let g = 0;
  while (sumGoae(working) + EPS < targetEuro && g++ < 120) {
    const rem = targetEuro - sumGoae(working);
    const cs = () => working.map((w) => w.code);
    let added = false;
    for (const code of PAD_CODES) {
      const row = goaeV2CodeById.get(code);
      if (!row) continue;
      if (cs().includes(code)) continue;
      if (codesGoaeConflict([...cs(), code])) continue;
      const item = serviceItemGoae(code, row.fee.thresholdFactor);
      if (!item || item.amount > rem + 120) continue;
      working.push(item);
      added = true;
      break;
    }
    if (!added) break;
  }

  for (let iter = 0; iter < 40; iter++) {
    const total = sumGoae(working);
    const diff = targetEuro - total;
    if (Math.abs(diff) < EPS) break;
    let bestJ = -1;
    let bestDeltaF = 0;
    for (let j = 0; j < working.length; j++) {
      const row = goaeV2CodeById.get(working[j]!.code);
      if (!row?.fee.points) continue;
      const k = row.fee.points * GOAE_PUNKTWERT;
      const lo = row.fee.thresholdFactor;
      const hi = row.fee.maxFactor;
      const cur = working[j]!.factor;
      let nextF = cur + diff / k;
      nextF = clamp(nextF, lo, hi);
      const df = nextF - cur;
      if (Math.abs(df) > Math.abs(bestDeltaF)) {
        bestDeltaF = df;
        bestJ = j;
      }
    }
    if (bestJ < 0 || Math.abs(bestDeltaF) < 1e-9) break;
    const u = withGoaeFactor(working[bestJ]!, working[bestJ]!.factor + bestDeltaF);
    if (!u) break;
    working[bestJ] = u;
  }

  return appendGoaeLinesTowardTarget(working, targetEuro);
}
