/**
 * Step 5 – Regelengine
 *
 * Deterministische Prüfung der Rechnung gegen GOÄ-Abrechnungsregeln.
 * KEIN LLM-Aufruf – rein regelbasierte Logik.
 *
 * Prüfungen:
 * - Ausschlussziffern (Kombinationsverbote)
 * - Betragsprüfung (Punkte × Punktwert × Faktor)
 * - Schwellenwert-Überschreitung (Begründungspflicht)
 * - Höchstsatz-Überschreitung
 * - Doppelabrechnung
 * - Fehlende Begründungen bei Faktor > Schwelle
 * - Analogabrechnung nach § 6 GOÄ
 *
 *   ParsedRechnung + GOÄ-Katalog → RegelpruefungErgebnis
 */

import type {
  ParsedRechnung,
  MedizinischeAnalyse,
  GoaeMappingResult,
  RegelpruefungErgebnis,
  GeprueftePosition,
  Pruefung,
  Optimierung,
  GoaeZuordnung,
} from "./types.ts";

const PUNKTWERT = 0.0582873;

// ---------- GOÄ Katalog-Daten (inline für Deno Edge Function) ----------

interface KatalogEintrag {
  ziffer: string;
  bezeichnung: string;
  punkte: number;
  schwellenfaktor: number;
  hoechstfaktor: number;
  ausschlussziffern: string[];
  abschnitt: string;
}

/**
 * Parst den kompakten Katalog-String aus goae-catalog.ts.
 * Format pro Zeile: ziffer|bezeichnung|punkte|einfachsatz|schwelle→betrag|max→betrag|Ausschl: ...
 */
function parseKatalog(katalogText: string): Map<string, KatalogEintrag> {
  const map = new Map<string, KatalogEintrag>();
  let currentAbschnitt = "";

  for (const line of katalogText.split("\n")) {
    const trimmed = line.trim();

    const abschnittMatch = trimmed.match(/^##\s+Abschnitt\s+(\w+)/);
    if (abschnittMatch) {
      currentAbschnitt = abschnittMatch[1];
      continue;
    }

    const parts = trimmed.split("|");
    if (parts.length < 5) continue;

    const ziffer = parts[0].trim();
    if (!ziffer || !/^[\dA]/.test(ziffer)) continue;

    const bezeichnung = parts[1]?.trim() || "";
    const punkte = parseInt(parts[2]?.trim() || "0", 10);
    if (isNaN(punkte) || punkte === 0) continue;

    let schwellenfaktor = 2.3;
    let hoechstfaktor = 3.5;

    const schwelleMatch = parts[4]?.match(/([\d,]+)→/);
    if (schwelleMatch) {
      schwellenfaktor = parseFloat(schwelleMatch[1].replace(",", "."));
    }

    const maxMatch = parts[5]?.match(/([\d,]+)→/);
    if (maxMatch) {
      hoechstfaktor = parseFloat(maxMatch[1].replace(",", "."));
    }

    const ausschlussStr = parts.slice(6).join("|");
    const ausMatch = ausschlussStr.match(/Ausschl:\s*(.+?)(?:\||$)/);
    const ausschlussziffern = ausMatch
      ? ausMatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    map.set(ziffer, {
      ziffer,
      bezeichnung,
      punkte,
      schwellenfaktor,
      hoechstfaktor,
      ausschlussziffern,
      abschnitt: currentAbschnitt,
    });
  }

  return map;
}

let _katalogCache: Map<string, KatalogEintrag> | null = null;

function getKatalog(katalogText: string): Map<string, KatalogEintrag> {
  if (!_katalogCache) {
    _katalogCache = parseKatalog(katalogText);
  }
  return _katalogCache;
}

// Expandiert Bereichsangaben wie "1210-1213" zu ["1210","1211","1212","1213"]
function expandRange(s: string): string[] {
  const rangeMatch = s.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    const result: string[] = [];
    for (let i = start; i <= end; i++) result.push(String(i));
    return result;
  }
  return [s];
}

function expandAusschluesse(raw: string[]): string[] {
  const result: string[] = [];
  for (const item of raw) {
    result.push(...expandRange(item));
  }
  return result;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------- Hauptlogik ----------

export function pruefeRechnung(
  rechnung: ParsedRechnung,
  analyse: MedizinischeAnalyse,
  mappings: GoaeMappingResult,
  katalogText: string,
): RegelpruefungErgebnis {
  const katalog = getKatalog(katalogText);
  const positionen: GeprueftePosition[] = [];
  const optimierungen: Optimierung[] = [];

  let korrekt = 0;
  let warnungen = 0;
  let fehler = 0;
  let rechnungsSumme = 0;
  let korrigierteSumme = 0;

  for (const pos of rechnung.positionen) {
    const eintrag = katalog.get(pos.ziffer);
    const pruefungen: Pruefung[] = [];

    const berechneterBetrag = eintrag
      ? round2(eintrag.punkte * PUNKTWERT * pos.faktor)
      : pos.betrag;

    rechnungsSumme += pos.betrag * pos.anzahl;

    // --- Prüfung 1: Betrag ---
    if (eintrag) {
      const diff = Math.abs(pos.betrag - berechneterBetrag);
      if (diff > 0.02) {
        pruefungen.push({
          typ: "betrag",
          schwere: "fehler",
          nachricht: `Betrag ${formatEuro(pos.betrag)} weicht ab. Korrekt bei ${pos.faktor}×: ${formatEuro(berechneterBetrag)} (${eintrag.punkte} Pkt × ${PUNKTWERT}€ × ${pos.faktor}).`,
          vorschlag: `Betrag auf ${formatEuro(berechneterBetrag)} korrigieren.`,
        });
      }
    }

    // --- Prüfung 2: Schwellenwert ---
    if (eintrag && pos.faktor > eintrag.schwellenfaktor) {
      const hatBegruendung = !!pos.begruendung;
      if (!hatBegruendung) {
        pruefungen.push({
          typ: "begruendung_fehlt",
          schwere: "warnung",
          nachricht: `Faktor ${pos.faktor}× überschreitet Schwellenwert ${eintrag.schwellenfaktor}×. Schriftliche Begründung gemäß § 5 Abs. 2 / § 12 Abs. 3 GOÄ erforderlich.`,
          vorschlag: begründungsVorschlag(pos.ziffer, pos.faktor, eintrag, analyse),
        });
      } else {
        pruefungen.push({
          typ: "schwellenwert",
          schwere: "info",
          nachricht: `Faktor ${pos.faktor}× über Schwelle ${eintrag.schwellenfaktor}× – Begründung vorhanden.`,
        });
      }
    }

    // --- Prüfung 3: Höchstsatz ---
    if (eintrag && pos.faktor > eintrag.hoechstfaktor) {
      pruefungen.push({
        typ: "hoechstsatz",
        schwere: "fehler",
        nachricht: `Faktor ${pos.faktor}× überschreitet den Höchstsatz von ${eintrag.hoechstfaktor}×. Ohne § 2-Vereinbarung nicht zulässig.`,
        vorschlag: `Faktor auf maximal ${eintrag.hoechstfaktor}× reduzieren oder § 2-Vereinbarung dokumentieren.`,
      });
    }

    // --- Prüfung 4: Ausschlussziffern ---
    if (eintrag) {
      const expandedAusschl = expandAusschluesse(eintrag.ausschlussziffern);
      for (const andere of rechnung.positionen) {
        if (andere.nr === pos.nr) continue;
        if (expandedAusschl.includes(andere.ziffer)) {
          const andereEintrag = katalog.get(andere.ziffer);
          pruefungen.push({
            typ: "ausschluss",
            schwere: "fehler",
            nachricht: `GOÄ ${pos.ziffer} ist neben GOÄ ${andere.ziffer}${andereEintrag ? ` (${andereEintrag.bezeichnung})` : ""} nicht berechnungsfähig.`,
            vorschlag: vorschlagAusschluss(pos, andere, eintrag, andereEintrag),
          });
        }
      }
    }

    // --- Prüfung 5: Doppelabrechnung ---
    const doppelt = rechnung.positionen.filter(
      (p) => p.ziffer === pos.ziffer && p.nr !== pos.nr,
    );
    if (doppelt.length > 0 && pos.nr < doppelt[0].nr) {
      pruefungen.push({
        typ: "doppelt",
        schwere: "warnung",
        nachricht: `GOÄ ${pos.ziffer} wird ${doppelt.length + 1}× abgerechnet. Prüfen, ob medizinisch gerechtfertigt (z.B. beidseitig).`,
      });
    }

    // --- Prüfung 6: Analogziffer ---
    const mapping = mappings.zuordnungen.find((m) => m.ziffer === pos.ziffer);
    if (mapping?.istAnalog) {
      if (!pos.bezeichnung.toLowerCase().includes("analog") &&
          !pos.bezeichnung.toLowerCase().includes("entsprechend")) {
        pruefungen.push({
          typ: "analog",
          schwere: "warnung",
          nachricht: `GOÄ ${pos.ziffer} als Analogziffer: Kennzeichnung „analog" oder „entsprechend" gemäß § 12 Abs. 4 GOÄ erforderlich.`,
          vorschlag: mapping.analogBegruendung ||
            `Bezeichnung ergänzen: "GOÄ ${pos.ziffer} analog – [tatsächlich erbrachte Leistung]"`,
        });
      }
    }

    // --- Status bestimmen ---
    const hatFehler = pruefungen.some((p) => p.schwere === "fehler");
    const hatWarnung = pruefungen.some((p) => p.schwere === "warnung");
    const status = hatFehler ? "fehler" : hatWarnung ? "warnung" : "korrekt";

    if (status === "korrekt") korrekt++;
    else if (status === "warnung") warnungen++;
    else fehler++;

    const korrigiert = eintrag ? berechneterBetrag : pos.betrag;
    korrigierteSumme += korrigiert * pos.anzahl;

    positionen.push({
      nr: pos.nr,
      ziffer: pos.ziffer,
      bezeichnung: eintrag?.bezeichnung || pos.bezeichnung,
      faktor: pos.faktor,
      betrag: pos.betrag,
      berechneterBetrag,
      status,
      pruefungen,
    });
  }

  // --- Optimierungsvorschläge ---
  for (const zuordnung of mappings.zuordnungen) {
    if (!zuordnung.leistung) continue;
    const istBereitsAbgerechnet = rechnung.positionen.some(
      (p) => p.ziffer === zuordnung.ziffer,
    );
    if (istBereitsAbgerechnet) continue;

    const eintrag = katalog.get(zuordnung.ziffer);
    if (!eintrag) continue;

    const faktor = eintrag.schwellenfaktor;
    const betrag = round2(eintrag.punkte * PUNKTWERT * faktor);

    optimierungen.push({
      typ: "fehlende_ziffer",
      ziffer: zuordnung.ziffer,
      bezeichnung: eintrag.bezeichnung,
      faktor,
      betrag,
      begruendung: `Leistung „${zuordnung.leistung}" erkannt – GOÄ ${zuordnung.ziffer} könnte ergänzt werden.`,
    });
  }

  // Zusätzliche legale Optimierung: Faktoranhebung bis zum Schwellenwert
  // nur bei bereits abgerechneten, ansonsten regelkonformen Positionen.
  for (const pos of positionen) {
    const eintrag = katalog.get(pos.ziffer);
    if (!eintrag) continue;
    if (pos.status === "fehler") continue;
    if (pos.faktor >= eintrag.schwellenfaktor) continue;

    const delta = round2(
      eintrag.punkte * PUNKTWERT * (eintrag.schwellenfaktor - pos.faktor) *
      (rechnung.positionen.find((p) => p.nr === pos.nr)?.anzahl || 1),
    );
    if (delta <= 0.01) continue;

    optimierungen.push({
      typ: "faktor_erhoehung",
      ziffer: pos.ziffer,
      bezeichnung: pos.bezeichnung,
      faktor: eintrag.schwellenfaktor,
      betrag: delta,
      begruendung:
        `Faktor aktuell ${pos.faktor}×. Eine Anhebung bis zum Schwellenwert ` +
        `${eintrag.schwellenfaktor}× kann im GOÄ-Regelrahmen liegen, sofern ` +
        `die dokumentierte Leistung mindestens durchschnittlich ausgeprägt ist.`,
    });
  }

  const optimierungsPotenzial = optimierungen.reduce(
    (sum, o) => sum + o.betrag,
    0,
  );

  return {
    positionen,
    optimierungen,
    zusammenfassung: {
      gesamt: rechnung.positionen.length,
      korrekt,
      warnungen,
      fehler,
      rechnungsSumme: round2(rechnungsSumme),
      korrigierteSumme: round2(korrigierteSumme),
      optimierungsPotenzial: round2(optimierungsPotenzial),
    },
  };
}

// ---------- Hilfs-Funktionen ----------

function formatEuro(n: number): string {
  return n.toFixed(2).replace(".", ",") + " €";
}

function vorschlagAusschluss(
  pos: { ziffer: string; betrag: number },
  andere: { ziffer: string; betrag: number },
  eintrag: KatalogEintrag | undefined,
  andereEintrag: KatalogEintrag | undefined,
): string {
  const posLabel = eintrag
    ? `GOÄ ${pos.ziffer} (${eintrag.bezeichnung}, ${formatEuro(pos.betrag)})`
    : `GOÄ ${pos.ziffer} (${formatEuro(pos.betrag)})`;
  const andereLabel = andereEintrag
    ? `GOÄ ${andere.ziffer} (${andereEintrag.bezeichnung}, ${formatEuro(andere.betrag)})`
    : `GOÄ ${andere.ziffer} (${formatEuro(andere.betrag)})`;

  if (pos.betrag >= andere.betrag) {
    return `${andereLabel} entfernen und ${posLabel} beibehalten (höherer Betrag).`;
  }
  return `${posLabel} entfernen und ${andereLabel} beibehalten (höherer Betrag).`;
}

function begründungsVorschlag(
  ziffer: string,
  faktor: number,
  eintrag: KatalogEintrag,
  analyse: MedizinischeAnalyse,
): string {
  const diagnose =
    analyse.diagnosen.length > 0
      ? analyse.diagnosen[0].text
      : "[Diagnose einfügen]";

  const context = analyse.klinischerKontext || "[klinischer Kontext]";

  return (
    `Begründungsvorschlag für GOÄ ${ziffer} (${eintrag.bezeichnung}) mit Faktor ${faktor}×: ` +
    `"Aufgrund der überdurchschnittlichen Schwierigkeit bei ${diagnose} ` +
    `und einem erhöhten Zeitaufwand ist ein Steigerungsfaktor von ${faktor}× ` +
    `gemäß § 5 Abs. 2 GOÄ gerechtfertigt. ${context}."`
  );
}
