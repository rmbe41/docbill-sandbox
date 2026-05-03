import ebmCatalogJson from "@/data/ebm-catalog-2026-q2.json";
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

export function sumEbm(items: readonly ServiceItemEbm[]): number {
  return r2(items.reduce((s, x) => s + (x.amount_eur ?? 0), 0));
}

export function sumGoae(items: readonly ServiceItemGoae[]): number {
  return r2(items.reduce((s, x) => s + x.amount, 0));
}

export function serviceItemEbm(gop: string): ServiceItemEbm | null {
  const row = ebmPositionByGop.get(gop);
  if (!row || row.euroWert <= 0) return null;
  return {
    code: row.gop,
    label: row.bezeichnung.trim() || row.gop,
    points: row.punktzahl,
    amount_eur: r2(row.euroWert),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Steigerung über den katalogisierten Schwellensatz (Regelhöchstfaktor) — typisch Begründungspflicht GOÄ */
export function goaeFactorRequiresJustification(code: string, factor: number): boolean {
  const row = goaeV2CodeById.get(code);
  if (!row) return false;
  return factor > row.fee.thresholdFactor + 0.009;
}

function factorJustificationForLine(code: string, factor: number, preferred?: string): Pick<ServiceItemGoae, "factor_justification"> | object {
  if (!goaeFactorRequiresJustification(code, factor)) return {};
  const t = preferred?.trim();
  if (t) return { factor_justification: t };
  const row = goaeV2CodeById.get(code);
  const th = row?.fee.thresholdFactor ?? 0;
  const fs = r2(factor).toFixed(2).replace(".", ",");
  const ts = r2(th).toFixed(2).replace(".", ",");
  return {
    factor_justification: `Steigerungsfaktor ${fs} gegenüber Schwellensatz ${ts} (GOÄ Nr. ${code}): erhöhter Zeitaufwand und besondere Schwierigkeit.`,
  };
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

/** Zusatzpositionen aus dem GOÄ-Katalog bis zur Ziel-Summe (nach Faktor-Anpassungen). */
function appendGoaeLinesTowardTarget(lines: readonly ServiceItemGoae[], targetEuro: number): ServiceItemGoae[] {
  const out = [...lines];
  let guard = 0;
  while (sumGoae(out) + EPS < targetEuro && guard++ < 9000) {
    const rem = targetEuro - sumGoae(out);
    const bundle = out.map((w) => w.code);
    let bestFit: ServiceItemGoae | null = null;
    for (const code of SANDBOX_GOAE_FILLERS_DESC) {
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

/** EBM: nur echte GOP-Beträge, optional Ziel € durch zusätzliche/abgetrennte Positionen (gleicher Ansatz wie Service-Billing: Summe aus Katalog) */
export function finalizeEbmToTarget(seedItems: readonly ServiceItemEbm[], targetEuro: number): ServiceItemEbm[] {
  let lines = [...seedItems];

  while (lines.length > 1 && sumEbm(lines) > targetEuro + EPS) {
    lines.sort((a, b) => (b.amount_eur ?? 0) - (a.amount_eur ?? 0));
    lines.shift();
  }

  let guard = 0;
  const used = () => new Set(lines.map((l) => l.code));
  while (sumEbm(lines) + EPS < targetEuro && guard++ < 4000) {
    const rem = targetEuro - sumEbm(lines);
    const u = used();
    let pick =
      SANDBOX_EBM_FILLERS_DESC.find((row) => !u.has(row.gop) && row.euroWert <= rem + EPS) ?? null;
    if (!pick)
      pick = SANDBOX_EBM_FILLERS_ASC.find((row) => !u.has(row.gop) && row.euroWert >= rem - EPS) ?? null;
    if (!pick) {
      pick = SANDBOX_EBM_FILLERS_ASC.find((row) => !u.has(row.gop)) ?? null;
    }
    if (!pick) {
      pick = SANDBOX_EBM_FILLERS_ASC[0] ?? null;
    }
    if (!pick) break;
    const item = serviceItemEbm(pick.gop);
    if (item) lines.push(item);
    else break;
  }

  return lines;
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
