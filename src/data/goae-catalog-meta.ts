/**
 * GOÄ-Katalog Metadaten – letzte Aktualisierung
 * Wird von scripts/fetch-goae-all.ts geschrieben.
 */

import goaeCatalogMetaJson from "./goae-catalog-meta.json";

export type GoaeCatalogMeta = {
  lastFetched: string;
  zifferCount: number;
};

export const goaeCatalogMeta: GoaeCatalogMeta =
  goaeCatalogMetaJson as GoaeCatalogMeta;
