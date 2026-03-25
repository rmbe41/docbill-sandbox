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
import {
  buildRegelKatalogMapFromJson,
  type RegelKatalogEintrag,
} from "../goae-catalog-json.ts";

const PUNKTWERT = 0.0582873;

// ---------- GOÄ Katalog aus goae-catalog-full.json (kanonisch) ----------

type KatalogEintrag = RegelKatalogEintrag;

let _katalogCache: Map<string, KatalogEintrag> | null = null;

/** katalogText wird nicht mehr geparst; Param bleibt aus Kompatibilität mit Aufrufern. */
function getKatalog(_katalogText: string): Map<string, KatalogEintrag> {
  if (!_katalogCache) {
    _katalogCache = buildRegelKatalogMapFromJson();
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

  // Bei Ausschluss: welche Positionen streichen (niedrigerer Betrag)
  const ausschlussExcluded = new Set<number>();

  let korrekt = 0;
  let warnungen = 0;
  let fehler = 0;
  let rechnungsSumme = 0;
  let korrigierteSumme = 0;

  // Erste Runde: Ausschluss-Paare ermitteln
  for (const pos of rechnung.positionen) {
    const eintrag = katalog.get(pos.ziffer);
    if (!eintrag) continue;
    const expandedAusschl = expandAusschluesse(eintrag.ausschlussziffern);
    for (const andere of rechnung.positionen) {
      if (andere.nr === pos.nr) continue;
      if (expandedAusschl.includes(andere.ziffer)) {
        const toExclude = pos.betrag <= andere.betrag ? pos.nr : andere.nr;
        ausschlussExcluded.add(toExclude);
      }
    }
  }

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
        // Bei Betragsfehler + Begründung mit Aufwand-Hinweis: Faktoranhebung prüfen
        const AUFWAND_KEYWORDS = /aufwändig|aufwendig|zeitaufwand|erhöht|enorm|verlängert|erschwert/i;
        const STARKER_AUFWAND_KEYWORDS = /enorm|sehr aufwändig|sehr aufwendig|erhöhter zeitaufwand|erhöhten zeitaufwand|enormer zeitaufwand/i;
        const deutetAufAufwand = pos.begruendung && AUFWAND_KEYWORDS.test(pos.begruendung);
        const deutetAufStarkenAufwand = pos.begruendung && STARKER_AUFWAND_KEYWORDS.test(pos.begruendung);
        if (deutetAufAufwand && pos.faktor < eintrag.schwellenfaktor) {
          const zielFaktor = deutetAufStarkenAufwand && pos.faktor < eintrag.hoechstfaktor
            ? eintrag.hoechstfaktor
            : eintrag.schwellenfaktor;
          const betragBeiZiel = round2(eintrag.punkte * PUNKTWERT * zielFaktor);
          const begruendungText = begruendungNurText(
            pos.ziffer,
            zielFaktor,
            eintrag,
            analyse,
          );
          pruefungen.push({
            typ: "faktor_erhoehung_empfohlen",
            schwere: "info",
            nachricht: deutetAufStarkenAufwand
              ? `Begründung deutet auf sehr hohen Aufwand. Höchstsatz ${eintrag.hoechstfaktor}× kann gerechtfertigt sein.`
              : `Begründung deutet auf höheren Aufwand. Schwellenwert: ${eintrag.schwellenfaktor}×, Höchstsatz: ${eintrag.hoechstfaktor}×.`,
            vorschlag: `Faktor auf ${zielFaktor}× erhöhen → ${formatEuro(betragBeiZiel)}.`,
            begruendungVorschlag: begruendungText,
            neueFaktor: zielFaktor,
            neuerBetrag: betragBeiZiel,
          });
        }
      }
    }

    // --- Prüfung 2: Schwellenwert ---
    if (eintrag && pos.faktor > eintrag.schwellenfaktor) {
      const hatBegruendung = !!pos.begruendung;
      if (!hatBegruendung) {
        const begruendungText = begruendungNurText(pos.ziffer, pos.faktor, eintrag, analyse);
        const berechneterBetragFuerPos = round2(eintrag.punkte * PUNKTWERT * pos.faktor);
        pruefungen.push({
          typ: "begruendung_fehlt",
          schwere: "warnung",
          nachricht: `Faktor ${pos.faktor}× überschreitet Schwellenwert ${eintrag.schwellenfaktor}×. Schriftliche Begründung gemäß § 5 Abs. 2 / § 12 Abs. 3 GOÄ erforderlich.`,
          vorschlag: begründungsVorschlag(pos.ziffer, pos.faktor, eintrag, analyse),
          begruendungVorschlag: begruendungText,
          neueFaktor: pos.faktor,
          neuerBetrag: berechneterBetragFuerPos,
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
        begruendungVorschlag:
          "§ 2-Vereinbarung: Schriftliche Vereinbarung mit Patient/in über Gebühren über dem Höchstsatz. Dokumentation: Zeitpunkt, Umfang und Zustimmung erforderlich.",
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
    // Bei Ausschluss: Position nicht in korrigierteSumme (wird gestrichen)
    if (!ausschlussExcluded.has(pos.nr)) {
      korrigierteSumme += korrigiert * pos.anzahl;
    }

    positionen.push({
      nr: pos.nr,
      ziffer: pos.ziffer,
      bezeichnung: eintrag?.bezeichnung || pos.bezeichnung,
      faktor: pos.faktor,
      betrag: pos.betrag,
      berechneterBetrag,
      status,
      pruefungen,
      begruendung: pos.begruendung,
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

/** Max. Länge für Begründungen (UI-Passform: Tabelle, Vorschlags-Box) */
const BEGRUENDUNG_MAX_CHARS = 140;

function begründungsVorschlag(
  ziffer: string,
  faktor: number,
  eintrag: KatalogEintrag,
  analyse: MedizinischeAnalyse,
): string {
  const text = begruendungNurText(ziffer, faktor, eintrag, analyse);
  return `Begründungsvorschlag für GOÄ ${ziffer} (${eintrag.bezeichnung}) mit Faktor ${faktor}×: „${text}"`;
}

/**
 * Fachlich hochwertige, UI-kompakte Begründung für Faktor > Schwellenwert.
 * Ziffer-spezifische Formulierungen, max. ~140 Zeichen für Tabellendarstellung.
 */
function begruendungNurText(
  ziffer: string,
  faktor: number,
  eintrag: KatalogEintrag,
  analyse: MedizinischeAnalyse,
): string {
  const diagnoseRaw =
    analyse.diagnosen.length > 0
      ? analyse.diagnosen[0].text
      : "[Diagnose]";
  const diagnose = diagnoseRaw.length > 50 ? diagnoseRaw.slice(0, 47) + "…" : diagnoseRaw;
  const ctx = (analyse.klinischerKontext || "").trim().slice(0, 50);

  const num = parseInt(ziffer.replace(/\D/g, ""), 10) || 0;

  let text: string;

  // Beratung (1–4): Zeitangabe wichtig
  if (num >= 1 && num <= 4) {
    text = `Eingehende Beratung von ca. 15–20 Min. aufgrund ${diagnose}. Faktor ${faktor}× gemäß § 5 Abs. 2 GOÄ gerechtfertigt.`;
  }
  // Spaltlampe/Fundus (1240–1244, 1248–1249)
  else if (num >= 1240 && num <= 1249) {
    text = `Erhöhter diagnostischer Aufwand durch ${diagnose} (erschwerte Darstellung/Beurteilung). Faktor ${faktor}× gerechtfertigt.`;
  }
  // Refraktion (1200–1218)
  else if (num >= 1200 && num <= 1218) {
    text = `Erschwerte Refraktion bei ${diagnose}. Faktor ${faktor}× gemäß § 5 Abs. 2 GOÄ gerechtfertigt.`;
  }
  // Tonometrie (1255–1257)
  else if (num >= 1255 && num <= 1257) {
    text = `Erschwerte Untersuchung bei ${diagnose}. Faktor ${faktor}× gerechtfertigt.`;
  }
  // Operative Leistungen (1275–1386)
  else if (num >= 1275 && num <= 1386) {
    text = `Erschwerter Zugang/verlängerte OP bei ${diagnose}. Faktor ${faktor}× gemäß § 5 Abs. 2 GOÄ gerechtfertigt.`;
  }
  // Untersuchungen 5–8
  else if (num >= 5 && num <= 8) {
    text = `Erhöhter Untersuchungsumfang bei ${diagnose}. Faktor ${faktor}× gerechtfertigt.`;
  }
  // Standard
  else {
    text = `Überdurchschnittliche Schwierigkeit bei ${diagnose}. Faktor ${faktor}× gemäß § 5 Abs. 2 GOÄ gerechtfertigt.`;
  }

  if (ctx.length > 5 && text.length + ctx.length < BEGRUENDUNG_MAX_CHARS - 3) {
    text = text.replace(/\.$/, `. ${ctx}.`);
  }
  return text.slice(0, BEGRUENDUNG_MAX_CHARS).trim();
}

// ---------- Service Billing Adapter ----------

/**
 * Erstellt eine Begründung für eine GOÄ-Position (Faktor > Schwellenwert).
 * Für Service Billing: Nutzung der ziffer-spezifischen Templates.
 */
export function erstelleBegruendungVorschlag(
  ziffer: string,
  faktor: number,
  analyse: MedizinischeAnalyse,
  katalogText: string,
): string {
  const katalog = getKatalog(katalogText);
  const eintrag = katalog.get(ziffer);
  if (!eintrag) {
    return `Faktor ${faktor}× gemäß § 5 Abs. 2 GOÄ begründen.`;
  }
  return begruendungNurText(ziffer, faktor, eintrag, analyse);
}

/**
 * Prüft Service-Billing-Vorschläge (GoaeZuordnung[]) gegen GOÄ-Regeln.
 * Gibt Ausschlüsse, Begründungsvorschläge und Compliance-Infos zurück.
 */
export function pruefeServiceBillingVorschlaege(
  zuordnungen: GoaeZuordnung[],
  analyse: MedizinischeAnalyse,
  katalogText: string,
): {
  geprueftePositionen: Map<string, GeprueftePosition>;
  excludedZiffern: Set<string>;
  begruendungVorschlaege: Map<string, string>;
  zusammenfassung: RegelpruefungErgebnis["zusammenfassung"];
} {
  const katalog = getKatalog(katalogText);
  const PUNKTWERT_LOCAL = 0.0582873;

  // Synthetische Rechnung aus Zuordnungen
  const positionen: { nr: number; ziffer: string; bezeichnung: string; faktor: number; betrag: number }[] = [];
  let nr = 1;
  for (const z of zuordnungen) {
    const eintrag = katalog.get(z.ziffer);
    const faktor = eintrag?.schwellenfaktor ?? 2.3;
    const punkte = eintrag?.punkte ?? 0;
    const betrag = punkte > 0 ? round2(punkte * PUNKTWERT_LOCAL * faktor) : 0;
    positionen.push({
      nr: nr++,
      ziffer: z.ziffer,
      bezeichnung: z.bezeichnung,
      faktor,
      betrag,
    });
  }

  const rechnung: ParsedRechnung = {
    positionen: positionen.map((p) => ({
      ...p,
      anzahl: 1,
    })),
    diagnosen: analyse.diagnosen.map((d) => d.text),
    rawText: analyse.klinischerKontext || "",
  };

  const mappings: GoaeMappingResult = { zuordnungen, fehlendeMappings: [] };
  const pruefung = pruefeRechnung(rechnung, analyse, mappings, katalogText);

  // Ausschluss: welche Positionen wurden ausgeschlossen (niedrigerer Betrag)
  const ausschlussExcluded = new Set<number>();
  for (const pos of rechnung.positionen) {
    const eintrag = katalog.get(pos.ziffer);
    if (!eintrag) continue;
    const expandedAusschl = expandAusschluesse(eintrag.ausschlussziffern);
    for (const andere of rechnung.positionen) {
      if (andere.nr === pos.nr) continue;
      if (expandedAusschl.includes(andere.ziffer)) {
        const toExclude = pos.betrag <= andere.betrag ? pos.nr : andere.nr;
        ausschlussExcluded.add(toExclude);
      }
    }
  }

  const excludedZiffern = new Set<string>();
  for (const p of rechnung.positionen) {
    if (ausschlussExcluded.has(p.nr)) excludedZiffern.add(p.ziffer);
  }

  const geprueftePositionen = new Map<string, GeprueftePosition>();
  for (const gp of pruefung.positionen) {
    geprueftePositionen.set(gp.ziffer, gp);
  }

  const begruendungVorschlaege = new Map<string, string>();
  for (const gp of pruefung.positionen) {
    const begruendungPruefung = gp.pruefungen.find(
      (p) => p.typ === "begruendung_fehlt" || p.typ === "faktor_erhoehung_empfohlen",
    );
    if (begruendungPruefung?.begruendungVorschlag) {
      begruendungVorschlaege.set(gp.ziffer, begruendungPruefung.begruendungVorschlag);
    }
  }

  return {
    geprueftePositionen,
    excludedZiffern,
    begruendungVorschlaege,
    zusammenfassung: pruefung.zusammenfassung,
  };
}
