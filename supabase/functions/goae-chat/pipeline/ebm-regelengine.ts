/**
 * EBM-Regelengine — deterministische Prüfung gegen EBM-Katalog (GOPs).
 * Kein LLM. Spiegelt die Struktur von `regelengine.ts` (GOÄ), andere Fachlogik.
 */

import { ebmByGop, type EbmGebuerenordnungsposition } from "../ebm-catalog-json.ts";
import type {
  ParsedRechnung,
  MedizinischeAnalyse,
  GoaeMappingResult,
  RegelpruefungErgebnis,
  GeprueftePosition,
  Pruefung,
  Optimierung,
} from "./types.ts";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatEuro(n: number): string {
  return n.toFixed(2).replace(".", ",") + " €";
}

function nrBeiAusschlussZuStreichen(
  pos: { nr: number; ziffer: string; betrag: number },
  andere: { nr: number; ziffer: string; betrag: number },
): number {
  if (pos.betrag !== andere.betrag) {
    return pos.betrag < andere.betrag ? pos.nr : andere.nr;
  }
  const zifferPunkteKey = (z: string): number => {
    const digits = z.replace(/\D/g, "");
    const n = parseInt(digits || "0", 10);
    return Number.isNaN(n) ? 0 : n;
  };
  const kp = zifferPunkteKey(pos.ziffer);
  const ko = zifferPunkteKey(andere.ziffer);
  if (kp !== ko) return kp < ko ? pos.nr : andere.nr;
  return pos.nr > andere.nr ? pos.nr : andere.nr;
}

function ausschlussGegenueber(
  a: EbmGebuerenordnungsposition,
  bGop: string,
): boolean {
  return a.abrechnungsbestimmungen.ausschluss.includes(bGop);
}

function ebmKollidieren(
  a: EbmGebuerenordnungsposition,
  b: EbmGebuerenordnungsposition,
): boolean {
  return ausschlussGegenueber(a, b.gop) || ausschlussGegenueber(b, a.gop);
}

/** Für Engine-3 / Paarvergleich: beide GOPs im Katalog und Ausschlussbeziehung. */
export function ebmZiffernKollidieren(za: string, zb: string): boolean {
  const a = ebmByGop.get(za.trim());
  const b = ebmByGop.get(zb.trim());
  if (!a || !b) return false;
  return ebmKollidieren(a, b);
}

export function pruefeRechnungEbm(
  rechnung: ParsedRechnung,
  _analyse: MedizinischeAnalyse,
  mappings: GoaeMappingResult,
): RegelpruefungErgebnis {
  const positionen: GeprueftePosition[] = [];
  const optimierungen: Optimierung[] = [];
  const ausschlussExcluded = new Set<number>();

  for (const pos of rechnung.positionen) {
    const ea = ebmByGop.get(pos.ziffer);
    if (!ea) continue;
    for (const andere of rechnung.positionen) {
      if (andere.nr === pos.nr) continue;
      const ebEntry = ebmByGop.get(andere.ziffer);
      if (!ebEntry) continue;
      if (ebmKollidieren(ea, ebEntry)) {
        ausschlussExcluded.add(nrBeiAusschlussZuStreichen(pos, andere));
      }
    }
  }

  let korrekt = 0;
  let warnungen = 0;
  let fehler = 0;
  let rechnungsSumme = 0;
  let korrigierteSumme = 0;

  const ziffernAufRechnung = new Set(
    rechnung.positionen.map((p) => p.ziffer.trim()).filter(Boolean),
  );

  for (const pos of rechnung.positionen) {
    const eintrag = ebmByGop.get(pos.ziffer);
    const pruefungen: Pruefung[] = [];

    const anzahl = Math.max(1, pos.anzahl || 1);
    const berechneterBetrag = eintrag
      ? round2(eintrag.euroWert * anzahl)
      : pos.betrag;

    rechnungsSumme += pos.betrag * (pos.anzahl || 1);

    if (!eintrag) {
      pruefungen.push({
        typ: "ebm_unbekannte_gop",
        schwere: "fehler",
        nachricht: `GOP ${pos.ziffer} ist nicht in der lokalen EBM-Datenbasis (nicht validierbar).`,
      });
    } else {
      const kannBetragPruefen = eintrag.punktzahl > 0 || eintrag.euroWert > 0;
      if (kannBetragPruefen) {
        const expected = round2(eintrag.euroWert * anzahl);
        const diff = Math.abs(pos.betrag - expected);
        if (diff > 0.02) {
          pruefungen.push({
            typ: "ebm_betrag",
            schwere: "fehler",
            nachricht:
              `Betrag ${formatEuro(pos.betrag)} weicht ab. Laut EBM-Katalog: ${formatEuro(expected)} ` +
              `(${eintrag.punktzahl} Pkt. × Orientierungswert, ${anzahl}×).`,
            vorschlag: `Betrag auf ${formatEuro(expected)} anpassen oder Anzahl prüfen.`,
            neuerBetrag: expected,
          });
        }
      } else {
        if (pos.betrag > 0.02) {
          pruefungen.push({
            typ: "ebm_betrag",
            schwere: "warnung",
            nachricht:
              "Für diese GOP liegt im Katalog kein Punkt-/Eurowert (0) – Betragsabgleich nicht möglich.",
          });
        }
      }

      const required = eintrag.abrechnungsbestimmungen.pflichtKombination ?? [];
      for (const reqGop of required) {
        if (!ziffernAufRechnung.has(reqGop)) {
          pruefungen.push({
            typ: "ebm_pflicht_kombi",
            schwere: "fehler",
            nachricht:
              `GOP ${pos.ziffer} setzt in der EBM-Struktur voraus, dass die GOP ${reqGop} in derselben Abrechnung vorkommt (Pflichtkombination).`,
            vorschlag: `GOP ${reqGop} ergänzen oder Leistung umbewerten.`,
          });
        }
      }
    }

    if (eintrag) {
      for (const andere of rechnung.positionen) {
        if (andere.nr === pos.nr) continue;
        const andereE = ebmByGop.get(andere.ziffer);
        if (!andereE) continue;
        if (ebmKollidieren(eintrag, andereE)) {
          const streichenNr = nrBeiAusschlussZuStreichen(pos, andere);
          if (pos.nr === streichenNr) {
            pruefungen.push({
              typ: "ebm_ausschluss",
              schwere: "fehler",
              nachricht:
                `EBM: GOP ${pos.ziffer} ist laut Katalogaussage nicht neben GOP ${andere.ziffer} berechnungsfähig ` +
                `(${eintrag.bezeichnung?.slice(0, 60) ?? pos.ziffer} / ${andereE.bezeichnung?.slice(0, 60) ?? andere.ziffer}).`,
              vorschlag: vorschlagEbmAusschluss(pos, andere, eintrag, andereE),
            });
          } else {
            pruefungen.push({
              typ: "ebm_ausschluss",
              schwere: "warnung",
              nachricht:
                `EBM-Ausschluss: Diese Zeile würde bei Regelkonformität beibehalten; ` +
                `GOP ${andere.ziffer} steht in Konflikt (wechselseitig/nicht neben).`,
              vorschlag: `GOP ${andere.ziffer} entfernen oder getrennt abrechnen.`,
            });
          }
        }
      }
    }

    const doppelt = rechnung.positionen.filter(
      (p) => p.ziffer === pos.ziffer && p.nr !== pos.nr,
    );
    if (doppelt.length > 0 && pos.nr < doppelt[0].nr) {
      pruefungen.push({
        typ: "ebm_doppelt",
        schwere: "warnung",
        nachricht: `GOP ${pos.ziffer} ist ${doppelt.length + 1}× aufgeführt. Prüfen, ob fachlich mehrfach zulässig.`,
      });
    }

    const hatFehler = pruefungen.some((p) => p.schwere === "fehler");
    const hatWarnung = pruefungen.some((p) => p.schwere === "warnung");
    const status = hatFehler ? "fehler" : hatWarnung ? "warnung" : "korrekt";
    if (status === "korrekt") korrekt++;
    else if (status === "warnung") warnungen++;
    else fehler++;

    const korrigiert = eintrag ? berechneterBetrag : pos.betrag;
    if (!ausschlussExcluded.has(pos.nr)) {
      korrigierteSumme += korrigiert * (pos.anzahl || 1);
    }

    const einE = ebmByGop.get(pos.ziffer);
    positionen.push({
      nr: pos.nr,
      ziffer: pos.ziffer,
      bezeichnung: einE?.bezeichnung || pos.bezeichnung,
      faktor: pos.faktor,
      betrag: pos.betrag,
      berechneterBetrag,
      status,
      pruefungen,
      begruendung: pos.begruendung,
    });
  }

  for (const zuordnung of mappings.zuordnungen) {
    if (!zuordnung.leistung) continue;
    const istBereits = rechnung.positionen.some((p) => p.ziffer === zuordnung.ziffer);
    if (istBereits) continue;
    const eintrag = ebmByGop.get(zuordnung.ziffer);
    if (!eintrag) continue;
    const kollidiert = rechnung.positionen.some((p) => {
      const pe = ebmByGop.get(p.ziffer);
      if (!pe) return false;
      return ebmKollidieren(eintrag, pe);
    });
    if (kollidiert) continue;
    if (eintrag.euroWert <= 0) continue;
    optimierungen.push({
      typ: "fehlende_ziffer",
      ziffer: zuordnung.ziffer,
      bezeichnung: eintrag.bezeichnung,
      faktor: 1,
      betrag: round2(eintrag.euroWert),
      begruendung:
        `Leistung „${zuordnung.leistung}" – GOP ${zuordnung.ziffer} ` +
        `könnte laut EBM-Auszug fehlen (Euro ${formatEuro(eintrag.euroWert)}).`,
    });
  }

  const optimierungsPotenzial = optimierungen.reduce((s, o) => s + o.betrag, 0);

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

function vorschlagEbmAusschluss(
  pos: { ziffer: string; betrag: number },
  andere: { ziffer: string; betrag: number },
  eintrag: EbmGebuerenordnungsposition,
  andereE: EbmGebuerenordnungsposition,
): string {
  const posL = `GOP ${pos.ziffer} (${eintrag.bezeichnung.slice(0, 40)}, ${formatEuro(pos.betrag)})`;
  const oL = `GOP ${andere.ziffer} (${andereE.bezeichnung.slice(0, 40)}, ${formatEuro(andere.betrag)})`;
  if (pos.betrag >= andere.betrag) {
    return `${oL} entfernen, ${posL} beibehalten.`;
  }
  return `${posL} entfernen, ${oL} beibehalten.`;
}

/**
 * Prüft Service-Billing-Zuordnungen (GOP) gegen EBM-Regeln.
 */
export function pruefeServiceBillingVorschlaegeEbm(
  zuordnungen: import("./types.ts").GoaeZuordnung[],
  analyse: MedizinischeAnalyse,
): {
  geprueftePositionen: Map<string, GeprueftePosition>;
  excludedZiffern: Set<string>;
  begruendungVorschlaege: Map<string, string>;
  zusammenfassung: RegelpruefungErgebnis["zusammenfassung"];
} {
  const positionen: {
    nr: number;
    ziffer: string;
    bezeichnung: string;
    faktor: number;
    betrag: number;
  }[] = [];
  let nr = 1;
  for (const z of zuordnungen) {
    const e = ebmByGop.get(z.ziffer);
    const betrag = e ? round2(e.euroWert) : 0;
    positionen.push({
      nr: nr++,
      ziffer: z.ziffer,
      bezeichnung: z.bezeichnung,
      faktor: 1,
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
  const pruefung = pruefeRechnungEbm(rechnung, analyse, mappings);

  const ausschlussExcluded = new Set<number>();
  for (const pos of rechnung.positionen) {
    const ea = ebmByGop.get(pos.ziffer);
    if (!ea) continue;
    for (const andere of rechnung.positionen) {
      if (andere.nr === pos.nr) continue;
      const eb = ebmByGop.get(andere.ziffer);
      if (!eb) continue;
      if (ebmKollidieren(ea, eb)) {
        ausschlussExcluded.add(nrBeiAusschlussZuStreichen(pos, andere));
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

  return {
    geprueftePositionen,
    excludedZiffern,
    begruendungVorschlaege: new Map(),
    zusammenfassung: pruefung.zusammenfassung,
  };
}
