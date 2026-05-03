/**
 * Übernahme von Service-Billing-Engine-Zeilen (goae-chat) in Sandbox-Invoice-DTOs.
 * Artefakt: `src/data/sandbox/sandbox-engine-billing.generated.json` (von scripts/sandbox erzeugt).
 */

import type { ServiceItemEbm, ServiceItemGoae } from "./types";
import {
  ebmPositionByGop,
  finalizeEbmSandboxLines,
  goaeFactorRequiresJustification,
  r2,
  unitEbmEuroFromCatalogRow,
} from "./sandboxTariff";
import artifact from "@/data/sandbox/sandbox-engine-billing.generated.json" with { type: "json" };

/** Minimal wie `ServiceBillingPosition` im Edge-Orchestrierer */
export type SandboxEngineBillingPosition = {
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  begruendung?: string;
};

export type SandboxEngineTemplateArtifact = {
  ebmVorschlaege?: SandboxEngineBillingPosition[];
  goaeVorschlaege?: SandboxEngineBillingPosition[];
};

export type SandboxEngineBillingArtifactFile = {
  useEngine?: boolean;
  generatedAt?: string | null;
  model?: string | null;
  byTemplateIndex?: SandboxEngineTemplateArtifact[];
};

const FILE = artifact as SandboxEngineBillingArtifactFile;

export function sandboxEngineBillingFile(): SandboxEngineBillingArtifactFile {
  return FILE;
}

/** Gruppiert mehrfaches Vorkommen derselben GOP zu einer Sandbox-Zeile mit optionaler Menge */
export function engineEbmVorschlaegeToSandboxItems(
  positions: SandboxEngineBillingPosition[],
): ServiceItemEbm[] {
  const buckets = new Map<string, SandboxEngineBillingPosition[]>();
  for (const p of positions) {
    const k = p.ziffer;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(p);
  }
  const items: ServiceItemEbm[] = [];
  for (const [code, list] of buckets) {
    const row0 = list[0]!;
    const cat = ebmPositionByGop.get(code);
    const label = (cat?.bezeichnung ?? row0.bezeichnung)?.trim() || code;
    const sumBetrag = list.reduce((s, x) => s + (Number.isFinite(x.betrag) ? x.betrag : 0), 0);
    let unit = list.length ? r2(sumBetrag / list.length) : 0;
    if (unit <= 0 && cat) {
      const u = unitEbmEuroFromCatalogRow(cat);
      if (u != null && u > 0) unit = u;
    }
    const qty = list.length;
    const amount_eur = r2(unit * qty);
    items.push({
      code,
      label,
      points: cat?.punktzahl,
      amount_eur,
      ...(qty > 1 ? { quantity: qty } : {}),
    });
  }
  return finalizeEbmSandboxLines(items);
}

export function engineGoaeVorschlaegeToSandboxItems(
  positions: SandboxEngineBillingPosition[],
): ServiceItemGoae[] {
  return positions.map((p) => {
    const need = goaeFactorRequiresJustification(p.ziffer, p.faktor);
    const jus = need && p.begruendung?.trim() ? p.begruendung.trim() : undefined;
    return {
      code: p.ziffer,
      label: p.bezeichnung?.trim() || p.ziffer,
      factor: r2(p.faktor),
      amount: r2(p.betrag),
      ...(jus ? { factor_justification: jus } : {}),
    };
  });
}

export function engineArtifactEntryForTemplateIndex(
  idx: number,
): SandboxEngineTemplateArtifact | undefined {
  if (!FILE.useEngine) return undefined;
  return FILE.byTemplateIndex?.[idx];
}
