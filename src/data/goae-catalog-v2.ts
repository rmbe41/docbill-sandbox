import goaeCatalogV2Json from "./goae-catalog-v2.json";
import type { GoaeV2Catalog, GoaeV2Code } from "./goae-catalog-v2-schema";

export const goaeCatalogV2 = goaeCatalogV2Json as GoaeV2Catalog;

export const goaeV2CodeById = new Map<string, GoaeV2Code>(
  goaeCatalogV2.codes.map((code) => [code.code, code]),
);

export function isGoaeV2CodeExcluded(a: string, b: string): boolean {
  const codeA = goaeV2CodeById.get(a);
  const codeB = goaeV2CodeById.get(b);
  return (
    codeA?.billingExclusions.some((ex) => ex.targetCode === b) === true ||
    codeB?.billingExclusions.some((ex) => ex.targetCode === a) === true
  );
}

