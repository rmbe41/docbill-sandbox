/**
 * Service-Billing-Orchestrator
 *
 * Pipeline für "Leistungen abrechnen": Nutzer beschreibt erbrachte Leistungen
 * (Text oder Behandlungsbericht) → System schlägt GOÄ-Positionen vor.
 *
 *   Text/Dokument → NLP → Leistungs-Extraktion → GOÄ-Mapping → Regelengine → Vorschläge
 */

import { parseBehandlungsbericht } from "./dokument-parser.ts";
import { analysiereMedizinisch } from "./medizinisches-nlp.ts";
import { mappeGoae } from "./goae-mapping.ts";
import { mappeEbm } from "./ebm-mapping.ts";
import { ebmByGop } from "../ebm-catalog-json.ts";
import {
  pruefeServiceBillingVorschlaege,
  erstelleBegruendungVorschlag,
} from "./regelengine.ts";
import { pruefeServiceBillingVorschlaegeEbm } from "./ebm-regelengine.ts";
import { getBegruendungBeispiele } from "./engine3/begruendung-beispiele.ts";
import {
  enrichSteigerungsBegruendungenBatch,
  type SteigerungBegruendungItem,
} from "./steigerungs-begruendung-llm.ts";
import { buildServiceKatalogMapFromJson } from "../goae-catalog-json.ts";
import type {
  ParsedRechnung,
  ExtrahierteLeistung,
  MedizinischeAnalyse,
  GoaeZuordnung,
  FilePayload,
  OptimizeFor,
} from "./types.ts";
import { buildAnalyseFromServiceBilling, encodeDocbillAnalyseSse } from "../analyse-envelope.ts";

const PUNKTWERT = 0.0582873;

export interface ServiceBillingPosition {
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  begruendung?: string;
  leistung: string;
  konfidenz: "hoch" | "mittel" | "niedrig";
  /** Herkunft: extrahierter Behandlungs-/Dokumenttext zur Zuordnung */
  quelleBeschreibung?: string;
}

export interface ServiceBillingSummary {
  gesamt: number;
  avg_factor: number;
  steigerungen: number;
  compliance_score?: number;
}

export interface SachkostenPosition {
  bezeichnung: string;
  betrag: number;
}

export interface ServiceBillingResult {
  vorschlaege: ServiceBillingPosition[];
  optimierungen?: ServiceBillingPosition[];
  sachkosten?: SachkostenPosition[];
  summary: ServiceBillingSummary;
  klinischerKontext: string;
  fachgebiet: string;
}

interface KatalogEintrag {
  punkte: number;
  schwellenfaktor: number;
  hoechstfaktor: number;
  bezeichnung: string;
}

let _katalogCache: Map<string, KatalogEintrag> | null = null;

function getKatalogMap(): Map<string, KatalogEintrag> {
  if (!_katalogCache) {
    _katalogCache = buildServiceKatalogMapFromJson();
  }
  return _katalogCache;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Stabiler Zeilen-Key wie im Frontend (ServiceBillingResult getKey). */
function serviceBillingRowId(isOpt: boolean, ziffer: string, leistung: string): string {
  return (isOpt ? "opt-" : "") + ziffer + "|" + leistung;
}

function berechneBetrag(ziffer: string, faktor: number): number {
  const katalog = getKatalogMap();
  const eintrag = katalog.get(ziffer);
  if (!eintrag) return 0;
  return round2(eintrag.punkte * PUNKTWERT * faktor);
}

/** Optimiert den Faktor basierend auf Katalog, Analyse und optional optimize_for */
function optimiereFaktor(
  ziffer: string,
  analyse: MedizinischeAnalyse,
  katalog: Map<string, KatalogEintrag>,
  optimizeFor?: string[],
): number {
  const eintrag = katalog.get(ziffer);
  if (!eintrag) return 2.3;
  const { schwellenfaktor, hoechstfaktor } = eintrag;
  let faktor = schwellenfaktor;

  const num = parseInt(ziffer.replace(/\D/g, ""), 10) || 0;
  const isMaxUmsatz = optimizeFor?.includes("maximaler_umsatz") ?? false;
  const hasComplexDiagnose =
    analyse.diagnosen.some(
      (d) =>
        d.text.length > 30 ||
        /komplex|feucht|schwer|chronisch|multipel|ausgedehnt/i.test(d.text),
    ) || /komplex|erschwert|erhöhter aufwand|intensiv/i.test(analyse.klinischerKontext || "");

  if (isMaxUmsatz && hasComplexDiagnose) {
    if (num >= 1275 && num <= 1386) {
      faktor = Math.min(hoechstfaktor, schwellenfaktor + 0.7);
    } else if (num >= 1240 && num <= 1249) {
      faktor = Math.min(hoechstfaktor, schwellenfaktor + 0.5);
    } else if (num >= 1 && num <= 8) {
      faktor = Math.min(hoechstfaktor, schwellenfaktor + 0.4);
    } else if (num >= 1200 && num <= 1218) {
      faktor = Math.min(hoechstfaktor, schwellenfaktor + 0.4);
    } else if (num >= 1255 && num <= 1257) {
      faktor = Math.min(hoechstfaktor, schwellenfaktor + 0.4);
    }
  }

  return Math.min(faktor, hoechstfaktor);
}

function normalizeMatchToken(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Ordnet eine Mapping-Zeile dem extrahierten NLP-Leistungstext zu (Dokumentbezug). */
function quelleBeschreibungFuerLeistungstext(
  leistungText: string,
  leistungen: ExtrahierteLeistung[],
): string | undefined {
  const t = normalizeMatchToken(leistungText);
  if (!t) return undefined;
  let best: ExtrahierteLeistung | undefined;
  let bestScore = 0;
  for (const l of leistungen) {
    const b = normalizeMatchToken(l.bezeichnung);
    if (!b) continue;
    if (t === b) return l.beschreibung;
    let score = 0;
    if (t.includes(b) || b.includes(t)) {
      score = Math.min(t.length, b.length);
    }
    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  }
  return best?.beschreibung;
}

/** Extrahiert Leistungen nur aus NLP (Behandlungen), ohne Rechnungspositionen. Ohne Sachkosten. */
function extrahiereLeistungenAusNlp(analyse: MedizinischeAnalyse): ExtrahierteLeistung[] {
  return analyse.behandlungen
    .filter((b) => b.typ !== "sachkosten")
    .map((b) => ({
      bezeichnung: b.text,
      beschreibung: `${b.text} (${b.typ})`,
      quelleBehandlung: b.text,
    }));
}

/** Extrahiert Sachkosten aus NLP (Materialien, Medikamente). */
function extrahiereSachkosten(analyse: MedizinischeAnalyse): SachkostenPosition[] {
  const sachkosten = analyse.behandlungen.filter((b) => b.typ === "sachkosten");
  return sachkosten.map((b) => {
    const betrag = parseBetragAusText(b.text);
    return { bezeichnung: b.text, betrag };
  });
}

/** Versucht einen Betrag aus dem Text zu extrahieren (z.B. "Avastin 150€" oder "OP-Set 12,50"). */
function parseBetragAusText(text: string): number {
  const match = text.match(/(\d+[.,]\d{2})\s*€?|(\d+)\s*€/);
  if (match) {
    const num = (match[1] || match[2] || "0").replace(",", ".");
    return parseFloat(num) || 0;
  }
  return 0;
}

async function runServiceBillingPipelineEbm(
  input: ServiceBillingInput,
  apiKey: string,
  parsedRechnung: ParsedRechnung,
  medizinischeAnalyse: MedizinischeAnalyse,
  leistungen: ExtrahierteLeistung[],
  sachkosten: SachkostenPosition[],
): Promise<ServiceBillingResult> {
  const kontextOk = input.kontextWissenEnabled !== false;
  const mappings = await mappeEbm(
    parsedRechnung,
    leistungen,
    medizinischeAnalyse,
    apiKey,
    input.model,
    kontextOk ? input.adminContext : undefined,
    kontextOk,
  );
  const { excludedZiffern, zusammenfassung: regelZusammenfassung } = pruefeServiceBillingVorschlaegeEbm(
    mappings.zuordnungen,
    medizinischeAnalyse,
  );
  const hauptZiffern = new Set(mappings.zuordnungen.map((z) => z.ziffer));

  const vorschlaege: ServiceBillingPosition[] = mappings.zuordnungen
    .filter((z) => !excludedZiffern.has(z.ziffer))
    .map((z: GoaeZuordnung) => {
      const e = ebmByGop.get(z.ziffer);
      const betrag = e ? round2(e.euroWert) : 0;
      const quelleBeschreibung = quelleBeschreibungFuerLeistungstext(z.leistung, leistungen);
      return {
        ziffer: z.ziffer,
        bezeichnung: e?.bezeichnung ?? z.bezeichnung,
        faktor: 1,
        betrag,
        begruendung: e
          ? `EBM: ${e.punktzahl} Pkt. / ${betrag.toFixed(2).replace(".", ",")} € laut Katalog.`
          : "GOP ohne vollständigen Katalogeintrag.",
        leistung: z.leistung,
        konfidenz: z.konfidenz,
        ...(quelleBeschreibung ? { quelleBeschreibung } : {}),
      };
    });

  const optimierungen: ServiceBillingPosition[] = [];
  for (const z of mappings.zuordnungen) {
    const alts = z.alternativZiffern ?? [];
    for (const altGop of alts) {
      if (hauptZiffern.has(altGop) || excludedZiffern.has(altGop)) continue;
      const e = ebmByGop.get(altGop);
      if (!e || e.euroWert <= 0) continue;
      hauptZiffern.add(altGop);
      const altQuelle = quelleBeschreibungFuerLeistungstext(z.leistung, leistungen);
      optimierungen.push({
        ziffer: altGop,
        bezeichnung: e.bezeichnung,
        faktor: 1,
        betrag: round2(e.euroWert),
        begruendung: `Alternative GOP (EBM) zu „${z.leistung}".`,
        leistung: `Alternative zu ${z.leistung}`,
        konfidenz: "mittel",
        ...(altQuelle ? { quelleBeschreibung: altQuelle } : {}),
      });
    }
  }

  const sachkostenSumme = sachkosten.reduce((sum, s) => sum + s.betrag, 0);
  const allPositionen = [...vorschlaege, ...optimierungen];
  const gesamt = allPositionen.reduce((sum, p) => sum + p.betrag, 0) + sachkostenSumme;
  const avg_factor = allPositionen.length > 0
    ? allPositionen.reduce((sum, p) => sum + p.faktor, 0) / allPositionen.length
    : 0;
  const gesamtPositionen = regelZusammenfassung.gesamt;
  const compliance_score = gesamtPositionen > 0
    ? round2(regelZusammenfassung.korrekt / gesamtPositionen)
    : undefined;

  return {
    vorschlaege,
    optimierungen: optimierungen.length > 0 ? optimierungen : undefined,
    sachkosten: sachkosten.length > 0 ? sachkosten : undefined,
    summary: {
      gesamt: round2(gesamt),
      avg_factor: round2(avg_factor),
      steigerungen: 0,
      compliance_score,
    },
    klinischerKontext: medizinischeAnalyse.klinischerKontext,
    fachgebiet: medizinischeAnalyse.fachgebiet,
  };
}

export interface ServiceBillingInput {
  /** Bei Dateien: Behandlungsbericht parsen; bei reinem Text: null */
  files?: FilePayload[];
  /** Nutzer-Nachricht (immer vorhanden, bei reinem Text = Hauptinhalt) */
  userMessage: string;
  model: string;
  extraRules?: string;
  /** Optimierungsziele aus Input-Parser (z.B. "maximal abrechnen" → maximaler_umsatz) */
  optimizeFor?: OptimizeFor[];
  /** RAG-/Dateiname-abgestimmter Admin-KI-Kontext (wie im Chat/Rechnungsmodus) */
  adminContext?: string;
  /** Default an: GOÄ-/Admin-Blöcke in LLM-Prompts */
  kontextWissenEnabled?: boolean;
  mode?: "A" | "B" | "C";
  regelwerk?: "GOAE" | "EBM";
  pseudonymSessionId?: string;
}

export async function runServiceBillingPipeline(
  input: ServiceBillingInput,
  apiKey: string,
): Promise<ServiceBillingResult> {
  const kontextOk = input.kontextWissenEnabled !== false;
  let parsedRechnung: ParsedRechnung;

  if (input.files && input.files.length > 0) {
    parsedRechnung = await parseBehandlungsbericht(
      input.files,
      apiKey,
      input.model,
      kontextOk ? input.adminContext : undefined,
    );
    if (input.userMessage?.trim()) {
      parsedRechnung.rawText = `${input.userMessage}\n\n---\n\n${parsedRechnung.rawText}`;
    }
  } else {
    parsedRechnung = {
      positionen: [],
      diagnosen: [],
      rawText: input.userMessage || "",
      freitext: input.userMessage,
    };
  }

  const medizinischeAnalyse = await analysiereMedizinisch(
    parsedRechnung,
    apiKey,
    input.model,
    kontextOk ? input.adminContext : undefined,
    kontextOk,
    { pseudonymSessionId: input.pseudonymSessionId },
  );

  const leistungen = extrahiereLeistungenAusNlp(medizinischeAnalyse);

  const sachkosten = extrahiereSachkosten(medizinischeAnalyse);

  if (leistungen.length === 0 && sachkosten.length === 0) {
    return {
      vorschlaege: [],
      optimierungen: undefined,
      sachkosten: undefined,
      summary: {
        gesamt: 0,
        avg_factor: 0,
        steigerungen: 0,
        compliance_score: undefined,
      },
      klinischerKontext: medizinischeAnalyse.klinischerKontext,
      fachgebiet: medizinischeAnalyse.fachgebiet,
    };
  }

  if (input.regelwerk === "EBM") {
    return runServiceBillingPipelineEbm(
      input,
      apiKey,
      parsedRechnung,
      medizinischeAnalyse,
      leistungen,
      sachkosten,
    );
  }

  const mappings = await mappeGoae(
    parsedRechnung,
    leistungen,
    medizinischeAnalyse,
    apiKey,
    input.model,
    kontextOk ? input.adminContext : undefined,
    kontextOk,
  );

  const katalog = getKatalogMap();
  const {
    excludedZiffern,
    begruendungVorschlaege,
    zusammenfassung: regelZusammenfassung,
  } = pruefeServiceBillingVorschlaege(
    mappings.zuordnungen,
    medizinischeAnalyse,
    "",
  );

  const hauptZiffern = new Set(mappings.zuordnungen.map((z) => z.ziffer));

  const vorschlaege: ServiceBillingPosition[] = mappings.zuordnungen
    .filter((z) => !excludedZiffern.has(z.ziffer))
    .map((z: GoaeZuordnung) => {
      const faktor = optimiereFaktor(
        z.ziffer,
        medizinischeAnalyse,
        katalog,
        input.optimizeFor,
      );
      const betrag = berechneBetrag(z.ziffer, faktor);
      const eintrag = katalog.get(z.ziffer);
      const schwellenfaktor = eintrag?.schwellenfaktor ?? 2.3;

      let begruendung: string;
      const regelBegruendung = begruendungVorschlaege.get(z.ziffer);
      if (regelBegruendung) {
        begruendung = regelBegruendung;
      } else if (z.istAnalog && z.analogBegruendung) {
        begruendung = z.analogBegruendung;
      } else if (faktor > schwellenfaktor) {
        begruendung = erstelleBegruendungVorschlag(
          z.ziffer,
          faktor,
          medizinischeAnalyse,
          "",
        );
      } else {
        begruendung = `Standardfaktor ${faktor}× (Schwellenwert) – keine Begründung erforderlich.`;
      }

      const quelleBeschreibung = quelleBeschreibungFuerLeistungstext(z.leistung, leistungen);
      const begruendungBeispiele = getBegruendungBeispiele(z.ziffer, faktor, {
        quelleText: quelleBeschreibung,
        begruendung,
      });
      return {
        ziffer: z.ziffer,
        bezeichnung: z.bezeichnung,
        faktor,
        betrag,
        begruendung,
        leistung: z.leistung,
        konfidenz: z.konfidenz,
        ...(quelleBeschreibung ? { quelleBeschreibung } : {}),
        ...(begruendungBeispiele.length ? { begruendungBeispiele } : {}),
      };
    });

  // Optimierungen aus alternativZiffern: Zusätzliche Ziffern, die nicht bereits vorgeschlagen sind
  const optimierungen: ServiceBillingPosition[] = [];
  for (const z of mappings.zuordnungen) {
    const alts = z.alternativZiffern ?? [];
    for (const altZiffer of alts) {
      if (hauptZiffern.has(altZiffer) || excludedZiffern.has(altZiffer)) continue;
      const eintrag = katalog.get(altZiffer);
      if (!eintrag) continue;

      const faktor = eintrag.schwellenfaktor;
      const betrag = berechneBetrag(altZiffer, faktor);
      hauptZiffern.add(altZiffer);

      let begruendung: string;
      const regelBegruendung = begruendungVorschlaege.get(altZiffer);
      if (regelBegruendung) {
        begruendung = regelBegruendung;
      } else if (faktor > eintrag.schwellenfaktor) {
        begruendung = erstelleBegruendungVorschlag(
          altZiffer,
          faktor,
          medizinischeAnalyse,
          "",
        );
      } else {
        begruendung = `Alternative zu GOÄ ${z.ziffer} (${z.bezeichnung}). Standardfaktor ${faktor}× (Schwellenwert) – keine Begründung erforderlich.`;
      }

      const altQuelle = quelleBeschreibungFuerLeistungstext(z.leistung, leistungen);
      const beispOpt = getBegruendungBeispiele(altZiffer, faktor, {
        quelleText: altQuelle,
        begruendung,
      });
      optimierungen.push({
        ziffer: altZiffer,
        bezeichnung: eintrag.bezeichnung,
        faktor,
        betrag,
        begruendung,
        leistung: `Alternative zu ${z.leistung}`,
        konfidenz: "mittel",
        ...(altQuelle ? { quelleBeschreibung: altQuelle } : {}),
        ...(beispOpt.length ? { begruendungBeispiele: beispOpt } : {}),
      });
    }
  }

  const steigerungItems: SteigerungBegruendungItem[] = [];
  for (const v of vorschlaege) {
    const eintrag = katalog.get(v.ziffer);
    const schwellenfaktor = eintrag?.schwellenfaktor ?? 2.3;
    const hoechstfaktor = eintrag?.hoechstfaktor ?? 3.5;
    if (v.faktor > schwellenfaktor) {
      steigerungItems.push({
        id: serviceBillingRowId(false, v.ziffer, v.leistung),
        ziffer: v.ziffer,
        bezeichnung: v.bezeichnung,
        faktor: v.faktor,
        schwellenfaktor,
        hoechstfaktor,
        leistung: v.leistung,
        ...(v.quelleBeschreibung ? { quelleBeschreibung: v.quelleBeschreibung } : {}),
      });
    }
  }
  for (const v of optimierungen) {
    const eintrag = katalog.get(v.ziffer);
    const schwellenfaktor = eintrag?.schwellenfaktor ?? 2.3;
    const hoechstfaktor = eintrag?.hoechstfaktor ?? 3.5;
    if (v.faktor > schwellenfaktor) {
      steigerungItems.push({
        id: serviceBillingRowId(true, v.ziffer, v.leistung),
        ziffer: v.ziffer,
        bezeichnung: v.bezeichnung,
        faktor: v.faktor,
        schwellenfaktor,
        hoechstfaktor,
        leistung: v.leistung,
        ...(v.quelleBeschreibung ? { quelleBeschreibung: v.quelleBeschreibung } : {}),
      });
    }
  }

  if (steigerungItems.length > 0) {
    const begrMap = await enrichSteigerungsBegruendungenBatch(
      steigerungItems,
      medizinischeAnalyse,
      apiKey,
      input.model,
      kontextOk ? input.adminContext : undefined,
      kontextOk,
    );
    for (const v of vorschlaege) {
      const t = begrMap.get(serviceBillingRowId(false, v.ziffer, v.leistung));
      if (t) v.begruendung = t;
    }
    for (const v of optimierungen) {
      const t = begrMap.get(serviceBillingRowId(true, v.ziffer, v.leistung));
      if (t) v.begruendung = t;
    }
  }

  const allPositionen = [...vorschlaege, ...optimierungen];
  const sachkostenSumme = sachkosten.reduce((sum, s) => sum + s.betrag, 0);
  const gesamt = allPositionen.reduce((sum, p) => sum + p.betrag, 0) + sachkostenSumme;
  const avg_factor =
    allPositionen.length > 0
      ? allPositionen.reduce((sum, p) => sum + p.faktor, 0) / allPositionen.length
      : 0;
  const steigerungen = allPositionen.filter((p) => {
    const e = katalog.get(p.ziffer);
    return e && p.faktor > e.schwellenfaktor;
  }).length;
  const gesamtPositionen = regelZusammenfassung.gesamt;
  const compliance_score =
    gesamtPositionen > 0
      ? round2(regelZusammenfassung.korrekt / gesamtPositionen)
      : undefined;

  return {
    vorschlaege,
    optimierungen: optimierungen.length > 0 ? optimierungen : undefined,
    sachkosten: sachkosten.length > 0 ? sachkosten : undefined,
    summary: {
      gesamt: round2(gesamt),
      avg_factor: round2(avg_factor),
      steigerungen,
      compliance_score,
    },
    klinischerKontext: medizinischeAnalyse.klinischerKontext,
    fachgebiet: medizinischeAnalyse.fachgebiet,
  };
}

/** SSE-Labels für Fortschritt */
const SERVICE_BILLING_STEPS = [
  { label: "Dokument wird analysiert..." },
  { label: "Leistungen werden erkannt..." },
  { label: "GOÄ-Zuordnung wird ermittelt..." },
  { label: "Vorschläge werden erstellt..." },
];

/** Führt die Service-Billing-Pipeline aus und gibt eine SSE-Response zurück */
export async function runServiceBillingAsStream(
  input: ServiceBillingInput,
  apiKey: string,
): Promise<Response> {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const sendProgress = async (step: number, label: string) => {
    const data = `data: ${JSON.stringify({
      type: "service_billing_progress",
      step: step + 1,
      totalSteps: SERVICE_BILLING_STEPS.length,
      label,
    })}\n\n`;
    await writer.write(encoder.encode(data));
  };

  (async () => {
    try {
      await sendProgress(0, SERVICE_BILLING_STEPS[0].label);
      const result = await runServiceBillingPipeline(input, apiKey);
      await sendProgress(SERVICE_BILLING_STEPS.length - 1, SERVICE_BILLING_STEPS[SERVICE_BILLING_STEPS.length - 1].label);

      const resultData = `data: ${JSON.stringify({
        type: "service_billing_result",
        data: result,
      })}\n\n`;
      await writer.write(encoder.encode(resultData));

      const analyseSb = buildAnalyseFromServiceBilling(
        input.mode ?? "B",
        input.regelwerk ?? "GOAE",
        result,
      );
      await writer.write(encoder.encode(encodeDocbillAnalyseSse(analyseSb)));

      const introText = "**Vorschlag** — Positionen unten in der Karte prüfen und bestätigen.\n\n";
      await writer.write(encoder.encode(`data: ${JSON.stringify({
        choices: [{ delta: { content: introText } }],
      })}\n\n`));

      await writer.close();
    } catch (error) {
      console.error("Service billing error:", error);
      const errMsg = error instanceof Error ? error.message : "Service-Billing-Fehler";
      const data = `data: ${JSON.stringify({ type: "service_billing_error", error: errMsg })}\n\n`;
      await writer.write(encoder.encode(data));
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
