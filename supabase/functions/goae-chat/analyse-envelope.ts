/**
 * Einheitliche Analyse-Ausgabe (Spec 02) — Version 1 SSE: `docbill_analyse`.
 */
import { extractZiffernFromText, goaeByZiffer } from "./goae-catalog-json.ts";
import { extractGopsFromText, ebmByGop, type EbmGebuerenordnungsposition } from "./ebm-catalog-json.ts";
import { ANALYSE_KATEGORIEN_TITEL } from "./analyse-kategorien.ts";

export type AnalyseModus = "A" | "B" | "C";
export type Regelwerk = "GOAE" | "EBM";

export type KennzeichnungStufe =
  | "SICHER"
  | "OPTIMIERUNG"
  | "PRÜFEN"
  | "RISIKO"
  | "FEHLER"
  | "UNVOLLSTÄNDIG";

export type KategorieStatus = "ok" | "warnung" | "fehler" | "optimierung";

/** Laufzeit-„eine Wahrheit“ für SSE; Abbildung auf Spec 7.5: Client `src/lib/knowledge/quellenreferenzMapping.ts`. */
export type Quellenreferenz = { typ: "GOAE_KATALOG" | "EBM_KATALOG" | "ADMIN" | "TEXT"; ref?: string };

export interface PruefItem {
  ziffer: string;
  regelwerk: Regelwerk;
  kennzeichnung: KennzeichnungStufe;
  text: string;
  euroBetrag?: number;
  quellen: Quellenreferenz[];
}

export interface KategorieErgebnis {
  kategorie: number;
  titel: string;
  status: KategorieStatus;
  items: PruefItem[];
}

export interface DualOption {
  primaer: {
    ziffer: string;
    faktor?: number;
    euroBetrag: number;
    begruendung: string;
    confidence: number;
  };
  alternativ: {
    ziffer: string;
    faktor?: number;
    euroBetrag: number;
    begruendung: string;
    confidence: number;
  };
  erklaerung: string;
}

export interface EinwilligungsHinweis {
  positionIndex: number;
  text: string;
  quelle: string;
}

/** Einziger KI-Disclaimer (Spec 00 / 07 §11) – identisch mit Frontend `docbillDisclaimer`. */
export const DOCBILL_KI_DISCLAIMER =
  "DocBill ist eine KI und kann Fehler machen. Eine Kontrolle der Ergebnisse ist erforderlich.";

/** @deprecated Verwende `DOCBILL_KI_DISCLAIMER` (einziger spezifizierter Disclaimer). */
export const DOCBILL_ANTWORT_DISCLAIMER = DOCBILL_KI_DISCLAIMER;

export interface DocbillAnalyseV1 {
  version: 1;
  mode: AnalyseModus;
  regelwerk: Regelwerk;
  kategorien: KategorieErgebnis[];
  dualOptions: DualOption[];
  einwilligungsHinweise: EinwilligungsHinweis[];
  disclaimer: string;
  /** Optionale Meta-Infos (z. B. PAD) */
  metadata?: {
    inputType?: string;
    detectedPadFormat?: string | null;
  };
}

function baseKategorien(): KategorieErgebnis[] {
  return ANALYSE_KATEGORIEN_TITEL.map((titel, i) => ({
    kategorie: i + 1,
    titel,
    status: "ok" as KategorieStatus,
    items: [] as PruefItem[],
  }));
}

function setKat(
  rows: KategorieErgebnis[],
  num: number,
  patch: Partial<Pick<KategorieErgebnis, "status">> & { push?: PruefItem },
) {
  const row = rows[num - 1];
  if (!row) return;
  if (patch.status) row.status = patch.status;
  if (patch.push) row.items.push(patch.push);
}

/** Post-Validierung: erwähnte Ziffern/GOPs gegen lokale JSON-Basis. */
export function validateCodesInText(text: string, regelwerk: Regelwerk): PruefItem[] {
  const items: PruefItem[] = [];
  if (!text?.trim()) return items;

  if (regelwerk === "GOAE") {
    const ziffern = extractZiffernFromText(text);
    const seen = new Set<string>();
    for (const z of ziffern) {
      if (seen.has(z)) continue;
      seen.add(z);
      if (!goaeByZiffer.has(z)) {
        items.push({
          ziffer: z,
          regelwerk: "GOAE",
          kennzeichnung: "PRÜFEN",
          text: `Ziffer ${z} nicht in der lokalen GOÄ-Datenbasis (nicht validierbar).`,
          quellen: [{ typ: "GOAE_KATALOG", ref: z }],
        });
      }
    }
    return items;
  }

  const gops = extractGopsFromText(text);
  const seen = new Set<string>();
  for (const g of gops) {
    if (seen.has(g)) continue;
    seen.add(g);
    if (!ebmByGop.has(g)) {
      items.push({
        ziffer: g,
        regelwerk: "EBM",
        kennzeichnung: "PRÜFEN",
        text: `GOP ${g} nicht in der lokalen EBM-Datenbasis (nicht validierbar).`,
        quellen: [{ typ: "EBM_KATALOG", ref: g }],
      });
    }
  }
  return items;
}

function ebmEuro(e: EbmGebuerenordnungsposition): number {
  return typeof e.euroWert === "number" ? e.euroWert : 0;
}

export function buildAnalyseFragemodus(
  mode: AnalyseModus,
  regelwerk: Regelwerk,
  kurzantwort: string,
  _vorschlaege?: { id: string; text: string }[],
): DocbillAnalyseV1 {
  const kategorien = baseKategorien();
  const combined = kurzantwort ?? "";
  const invalid = validateCodesInText(combined, regelwerk);
  if (invalid.length > 0) {
    setKat(kategorien, 1, { status: "warnung" });
    for (const it of invalid) setKat(kategorien, 1, { push: it });
  }

  return {
    version: 1,
    mode,
    regelwerk,
    kategorien,
    dualOptions: [],
    einwilligungsHinweise: [],
    disclaimer: DOCBILL_KI_DISCLAIMER,
  };
}

/** Modus A/B Pipelines mit GOÄ-Prüfungsergebnis (vereinfachte Zuordnung auf Kategorien). */
export function buildAnalyseFromPruefungSnapshot(params: {
  mode: AnalyseModus;
  regelwerk: Regelwerk;
  positionen: { ziffer: string; betrag?: number; faktor?: number }[];
  optimierungscount?: number;
}): DocbillAnalyseV1 {
  const kategorien = baseKategorien();
  const rw: Regelwerk = params.regelwerk;

  for (const p of params.positionen) {
    const z = String(p.ziffer ?? "").trim();
    if (!z) continue;
    if (rw === "GOAE" && !goaeByZiffer.has(z)) {
      setKat(kategorien, 1, {
        status: "warnung",
        push: {
          ziffer: z,
          regelwerk: "GOAE",
          kennzeichnung: "FEHLER",
          text: `Ziffer ${z} nicht in GOÄ-JSON.`,
          euroBetrag: p.betrag,
          quellen: [{ typ: "GOAE_KATALOG", ref: z }],
        },
      });
    }
    if (rw === "EBM" && !ebmByGop.has(z)) {
      setKat(kategorien, 1, {
        status: "warnung",
        push: {
          ziffer: z,
          regelwerk: "EBM",
          kennzeichnung: "FEHLER",
          text: `GOP ${z} nicht in EBM-JSON.`,
          euroBetrag: p.betrag,
          quellen: [{ typ: "EBM_KATALOG", ref: z }],
        },
      });
    }
  }

  if ((params.optimierungscount ?? 0) > 0) {
    setKat(kategorien, 6, { status: "optimierung" });
  }

  return {
    version: 1,
    mode: params.mode,
    regelwerk: rw,
    kategorien,
    dualOptions: [],
    einwilligungsHinweise: [],
    disclaimer: DOCBILL_KI_DISCLAIMER,
  };
}

/** Aus Regelengine-Ergebnis (GOÄ-Pipeline): Kategorien 1–6 grob befüllen. */
export function buildAnalyseFromRegelpruefung(
  mode: AnalyseModus,
  regelwerk: Regelwerk,
  pruefung: {
    positionen: {
      ziffer: string;
      betrag: number;
      faktor: number;
      status: string;
      pruefungen: { typ: string; schwere: string; nachricht: string }[];
    }[];
    optimierungen: { ziffer: string; betrag: number; begruendung: string }[];
  },
): DocbillAnalyseV1 {
  const kategorien = baseKategorien();
  const rw: Regelwerk = regelwerk;

  for (const p of pruefung.positionen) {
    const z = String(p.ziffer ?? "").trim();
    if (rw === "GOAE" && z && !goaeByZiffer.has(z)) {
      setKat(kategorien, 1, {
        status: "warnung",
        push: {
          ziffer: z,
          regelwerk: "GOAE",
          kennzeichnung: "FEHLER",
          text: `Ziffer ${z} nicht in GOÄ-JSON.`,
          euroBetrag: p.betrag,
          quellen: [{ typ: "GOAE_KATALOG", ref: z }],
        },
      });
    }
    if (rw === "EBM" && z && !ebmByGop.has(z)) {
      setKat(kategorien, 1, {
        status: "warnung",
        push: {
          ziffer: z,
          regelwerk: "EBM",
          kennzeichnung: "FEHLER",
          text: `GOP ${z} nicht in EBM-JSON.`,
          euroBetrag: p.betrag,
          quellen: [{ typ: "EBM_KATALOG", ref: z }],
        },
      });
    }
    for (const pv of p.pruefungen ?? []) {
      const kenn: KennzeichnungStufe =
        pv.schwere === "fehler" ? "FEHLER" : pv.schwere === "warnung" ? "PRÜFEN" : "SICHER";
      if (
        pv.typ === "ausschluss" ||
        pv.typ === "doppelt" ||
        pv.typ === "ebm_ausschluss" ||
        pv.typ === "ebm_doppelt"
      ) {
        setKat(kategorien, 5, {
          status: pv.schwere === "fehler" ? "fehler" : "warnung",
          push: {
            ziffer: z,
            regelwerk: rw,
            kennzeichnung: kenn,
            text: pv.nachricht,
            euroBetrag: p.betrag,
            quellen: [{ typ: "TEXT" }],
          },
        });
      } else if (pv.typ === "ebm_pflicht_kombi") {
        setKat(kategorien, 8, {
          status: pv.schwere === "fehler" ? "fehler" : "warnung",
          push: {
            ziffer: z,
            regelwerk: "EBM",
            kennzeichnung: kenn,
            text: pv.nachricht,
            euroBetrag: p.betrag,
            quellen: [{ typ: "EBM_KATALOG", ref: z }],
          },
        });
      } else if (pv.typ === "begruendung_fehlt") {
        setKat(kategorien, 3, {
          status: "warnung",
          push: {
            ziffer: z,
            regelwerk: rw,
            kennzeichnung: "PRÜFEN",
            text: pv.nachricht,
            quellen: [{ typ: "TEXT" }],
          },
        });
      } else if (pv.typ === "analog") {
        setKat(kategorien, 4, {
          status: "warnung",
          push: {
            ziffer: z,
            regelwerk: rw,
            kennzeichnung: "PRÜFEN",
            text: pv.nachricht,
            quellen: [{ typ: "TEXT" }],
          },
        });
      } else if (
        pv.typ === "betrag" ||
        pv.typ === "schwellenwert" ||
        pv.typ === "hoechstsatz" ||
        pv.typ === "faktor_erhoehung_empfohlen" ||
        pv.typ === "ebm_betrag" ||
        pv.typ === "ebm_unbekannte_gop" ||
        pv.typ === "ebm_meta_unvollstaendig"
      ) {
        const qTyp: Quellenreferenz["typ"] = rw === "EBM" ? "EBM_KATALOG" : "GOAE_KATALOG";
        setKat(kategorien, 2, {
          status: p.status === "fehler" ? "fehler" : "warnung",
          push: {
            ziffer: z,
            regelwerk: rw,
            kennzeichnung: kenn,
            text: pv.nachricht,
            euroBetrag: p.betrag,
            quellen: [{ typ: qTyp, ref: z }],
          },
        });
      }
    }
    if (p.status === "fehler") setKat(kategorien, 1, { status: "fehler" });
    else if (p.status === "warnung") setKat(kategorien, 1, { status: "warnung" });
  }

  for (const o of pruefung.optimierungen ?? []) {
    setKat(kategorien, 6, {
      status: "optimierung",
      push: {
        ziffer: o.ziffer,
        regelwerk: rw,
        kennzeichnung: "OPTIMIERUNG",
        text: o.begruendung,
        euroBetrag: o.betrag,
        quellen: [{ typ: "TEXT" }],
      },
    });
  }

  return {
    version: 1,
    mode,
    regelwerk: rw,
    kategorien,
    dualOptions: [],
    einwilligungsHinweise: [],
    disclaimer: DOCBILL_KI_DISCLAIMER,
  };
}

export function buildAnalyseFromEbmPositions(params: {
  mode: AnalyseModus;
  gops: { gop: string; einzelbetrag: number; punktzahl?: number }[];
}): DocbillAnalyseV1 {
  const kategorien = baseKategorien();
  for (const row of params.gops) {
    const e = ebmByGop.get(row.gop);
    const expected = e ? ebmEuro(e) : 0;
    const punktOk = !e || row.punktzahl === undefined || e.punktzahl === row.punktzahl;
    const betragOk = !e || Math.abs((row.einzelbetrag ?? 0) - expected) < 0.02;

    if (!e) {
      setKat(kategorien, 1, {
        status: "fehler",
        push: {
          ziffer: row.gop,
          regelwerk: "EBM",
          kennzeichnung: "FEHLER",
          text: "GOP nicht in EBM-Datenbasis.",
          euroBetrag: row.einzelbetrag,
          quellen: [{ typ: "EBM_KATALOG", ref: row.gop }],
        },
      });
    } else if (!punktOk || !betragOk) {
      setKat(kategorien, 2, {
        status: "warnung",
        push: {
          ziffer: row.gop,
          regelwerk: "EBM",
          kennzeichnung: "PRÜFEN",
          text: !punktOk
            ? `Punktzahl weicht von Katalog (${e.punktzahl}) ab.`
            : `Euro-Betrag weicht von Katalog (${expected.toFixed(2)} €) ab.`,
          euroBetrag: expected,
          quellen: [{ typ: "EBM_KATALOG", ref: row.gop }],
        },
      });
    }
  }

  return {
    version: 1,
    mode: params.mode,
    regelwerk: "EBM",
    kategorien,
    dualOptions: [],
    einwilligungsHinweise: [],
    disclaimer: DOCBILL_KI_DISCLAIMER,
  };
}

/** Engine 3 / schlanke Positionslisten ohne Regelengine-Detail. */
export function buildAnalyseFromEngine3Like(
  mode: AnalyseModus,
  regelwerk: Regelwerk,
  data: {
    positionen: { ziffer: string; betrag: number; status: string }[];
    optimierungen?: { ziffer: string; betrag: number }[];
  },
): DocbillAnalyseV1 {
  return buildAnalyseFromPruefungSnapshot({
    mode,
    regelwerk,
    positionen: data.positionen.map((p) => ({ ziffer: p.ziffer, betrag: p.betrag })),
    optimierungscount: data.optimierungen?.length ?? 0,
  });
}

export function buildAnalyseFromServiceBilling(
  mode: AnalyseModus,
  regelwerk: Regelwerk,
  result: {
    vorschlaege: {
      ziffer: string;
      betrag: number;
      konfidenz: "hoch" | "mittel" | "niedrig";
    }[];
    optimierungen?: { ziffer: string; betrag: number; begruendung: string }[];
  },
): DocbillAnalyseV1 {
  const kategorien = baseKategorien();
  for (const v of result.vorschlaege) {
    if (regelwerk === "GOAE" && !goaeByZiffer.has(v.ziffer)) {
      setKat(kategorien, 1, {
        status: "warnung",
        push: {
          ziffer: v.ziffer,
          regelwerk: "GOAE",
          kennzeichnung: "PRÜFEN",
          text: `Ziffer ${v.ziffer} nicht in GOÄ-JSON.`,
          euroBetrag: v.betrag,
          quellen: [{ typ: "GOAE_KATALOG", ref: v.ziffer }],
        },
      });
    }
    if (regelwerk === "EBM" && !ebmByGop.has(v.ziffer)) {
      setKat(kategorien, 1, {
        status: "warnung",
        push: {
          ziffer: v.ziffer,
          regelwerk: "EBM",
          kennzeichnung: "PRÜFEN",
          text: `GOP ${v.ziffer} nicht in EBM-JSON.`,
          euroBetrag: v.betrag,
          quellen: [{ typ: "EBM_KATALOG", ref: v.ziffer }],
        },
      });
    }
  }
  for (const o of result.optimierungen ?? []) {
    setKat(kategorien, 6, {
      status: "optimierung",
      push: {
        ziffer: o.ziffer,
        regelwerk,
        kennzeichnung: "OPTIMIERUNG",
        text: o.begruendung,
        euroBetrag: o.betrag,
        quellen: [{ typ: "TEXT" }],
      },
    });
  }
  const dual: DualOption[] = [];
  const low = result.vorschlaege.filter((x) => x.konfidenz === "niedrig");
  if (low.length > 0 && (result.optimierungen?.length ?? 0) > 0) {
    const a = low[0]!;
    const b = result.optimierungen![0]!;
    dual.push({
      primaer: {
        ziffer: a.ziffer,
        euroBetrag: a.betrag,
        begruendung: "Primärvorschlag (niedrige Konfidenz)",
        confidence: 0.55,
      },
      alternativ: {
        ziffer: b.ziffer,
        euroBetrag: b.betrag,
        begruendung: "Alternativ aus Optimierung",
        confidence: 0.52,
      },
      erklaerung: "Konfidenz unterhalb der Schwelle — zwei Zuordnungen prüfen.",
    });
  }
  return {
    version: 1,
    mode,
    regelwerk,
    kategorien,
    dualOptions: dual,
    einwilligungsHinweise: [],
    disclaimer: DOCBILL_KI_DISCLAIMER,
  };
}

export function encodeDocbillAnalyseSse(payload: DocbillAnalyseV1): string {
  return `data: ${JSON.stringify({ type: "docbill_analyse", data: payload })}\n\n`;
}

export function mergeDualOptions(
  base: DocbillAnalyseV1,
  dual: DualOption[],
): DocbillAnalyseV1 {
  return { ...base, dualOptions: dual };
}
