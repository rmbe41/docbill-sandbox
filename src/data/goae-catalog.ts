/**
 * GOÄ-Ziffernkatalog – Strukturierte Wissensdatenbank
 * Quelle: abrechnungsstelle.com/goae/ziffern/
 *
 * Vollständiger Katalog aus allen Abschnitten (1–6018, analog)
 * Import aus goae-catalog-full.json (generiert via scripts/fetch-goae-all.ts)
 */

import goaeCatalogFull from "./goae-catalog-full.json";

export type GoaeZiffer = {
  ziffer: string;
  bezeichnung: string;
  punkte: number;
  einfachsatz: number;
  /** Steigerungsfaktor für den Regelhöchstsatz (Schwellenwert) */
  schwellenfaktor: number;
  regelhoechstsatz: number;
  /** Steigerungsfaktor für den Höchstsatz */
  hoechstfaktor: number;
  hoechstsatz: number;
  ausschlussziffern: string[];
  hinweise?: string;
  abschnitt: string;
  kategorie?: string;
};

/** Vollständiger GOÄ-Katalog (alle Abschnitte A–P, analog) */
export const goaeCatalog: GoaeZiffer[] = goaeCatalogFull as GoaeZiffer[];

/**
 * Schnellzugriff: Ziffer → Objekt
 */
export const goaeByZiffer = new Map<string, GoaeZiffer>(
  goaeCatalog.map((z) => [z.ziffer, z])
);

/**
 * Alle Kategorien im Katalog (nur bei Einträgen mit kategorie)
 */
export const goaeKategorien = [
  ...new Set(goaeCatalog.map((z) => z.kategorie).filter(Boolean)),
] as string[];

/**
 * Prüft, ob zwei Ziffern sich gegenseitig ausschließen.
 */
export function sindAusgeschlossen(a: string, b: string): boolean {
  const zA = goaeByZiffer.get(a);
  const zB = goaeByZiffer.get(b);
  return (
    (zA?.ausschlussziffern.includes(b) ?? false) ||
    (zB?.ausschlussziffern.includes(a) ?? false)
  );
}

/**
 * Findet alle Ausschlüsse innerhalb einer gegebenen Ziffernliste.
 */
export function findeAusschluesse(
  ziffern: string[]
): { a: string; b: string; grund: string }[] {
  const konflikte: { a: string; b: string; grund: string }[] = [];
  for (let i = 0; i < ziffern.length; i++) {
    for (let j = i + 1; j < ziffern.length; j++) {
      if (sindAusgeschlossen(ziffern[i], ziffern[j])) {
        konflikte.push({
          a: ziffern[i],
          b: ziffern[j],
          grund: `GOÄ ${ziffern[i]} ist neben GOÄ ${ziffern[j]} nicht berechnungsfähig`,
        });
      }
    }
  }
  return konflikte;
}
