/**
 * Spec 8.5 — GOÄ-/EBM-JSON: Integritätsprüfung beim Start der Edge-Function (kein separater Disk-Persist).
 */
import { EBM_DATENBANK } from "./ebm-catalog-json.ts";
import { GOAE_CATALOG_ENTRIES } from "./goae-catalog-json.ts";

export function validateReferenceCatalogBundles(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!EBM_DATENBANK?.version || String(EBM_DATENBANK.version).trim() === "") {
    errors.push("EBM-JSON: version fehlt oder leer");
  }
  if (typeof EBM_DATENBANK?.orientierungswert !== "number" || EBM_DATENBANK.orientierungswert <= 0) {
    errors.push("EBM-JSON: orientierungswert ungültig");
  }
  if (!Array.isArray(EBM_DATENBANK?.gops) || EBM_DATENBANK.gops.length === 0) {
    errors.push("EBM-JSON: gops fehlt oder leer");
  }
  if (!Array.isArray(EBM_DATENBANK?.kapitel)) {
    errors.push("EBM-JSON: kapitel fehlt");
  }
  if (!Array.isArray(EBM_DATENBANK?.allgemeineBestimmungen)) {
    errors.push("EBM-JSON: allgemeineBestimmungen fehlt");
  }

  if (!Array.isArray(GOAE_CATALOG_ENTRIES) || GOAE_CATALOG_ENTRIES.length === 0) {
    errors.push("GOÄ-JSON: Katalog leer oder nicht geladen");
  } else {
    const sample = GOAE_CATALOG_ENTRIES[0];
    if (!sample?.ziffer || sample.bezeichnung == null) {
      errors.push("GOÄ-JSON: Katalogeinträge haben unerwartetes Format");
    }
  }

  return { ok: errors.length === 0, errors };
}

let cached: { ok: boolean; errors: string[] } | null = null;

export function getReferenceCatalogHealth(): { ok: boolean; errors: string[] } {
  if (!cached) cached = validateReferenceCatalogBundles();
  return cached;
}
