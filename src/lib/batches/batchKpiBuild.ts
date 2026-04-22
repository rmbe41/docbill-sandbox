import { kennFromLegacyPill } from "@/lib/batches/batchKennzeichnungDisplay";
import type { BatchKpi, BatchRechnungDetail } from "@/lib/batches/batchTypes";

export function buildKpiFromDetail(detail: BatchRechnungDetail): BatchKpi {
  const k: BatchKpi = {
    hinweisGesamt: 0,
    pruefen: 0,
    risiko: 0,
    optimierung: 0,
    fehler: 0,
    unvollstaendig: 0,
  };
  for (const p of detail.positionen) {
    const ke = p.kennzeichnung ?? kennFromLegacyPill(p.pill);
    if (ke === "SICHER") continue;
    if (ke === "PRÜFEN") k.pruefen += 1;
    if (ke === "RISIKO") k.risiko += 1;
    if (ke === "OPTIMIERUNG") k.optimierung += 1;
    if (ke === "FEHLER") k.fehler += 1;
    if (ke === "UNVOLLSTÄNDIG") k.unvollstaendig += 1;
    k.hinweisGesamt += 1;
  }
  return k;
}

export function recomputeDetailKpi(detail: BatchRechnungDetail): BatchRechnungDetail {
  return { ...detail, kpi: buildKpiFromDetail(detail) };
}
