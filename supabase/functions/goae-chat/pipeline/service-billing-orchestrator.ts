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
import {
  pruefeServiceBillingVorschlaege,
  erstelleBegruendungVorschlag,
} from "./regelengine.ts";
import { GOAE_KATALOG } from "../goae-catalog.ts";
import type {
  ParsedRechnung,
  ExtrahierteLeistung,
  MedizinischeAnalyse,
  GoaeZuordnung,
  FilePayload,
  OptimizeFor,
} from "./types.ts";

const PUNKTWERT = 0.0582873;

export interface ServiceBillingPosition {
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  begruendung?: string;
  leistung: string;
  konfidenz: "hoch" | "mittel" | "niedrig";
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

/** Parst Katalog-Zeile für Punkte, Schwellenfaktor, Höchstfaktor und Bezeichnung */
function parseKatalogEintrag(katalogText: string): Map<string, KatalogEintrag> {
  const map = new Map<string, KatalogEintrag>();

  for (const line of katalogText.split("\n")) {
    const trimmed = line.trim();
    const parts = trimmed.split("|");
    if (parts.length < 5) continue;

    const ziffer = parts[0].trim();
    if (!ziffer || !/^[\dA]/.test(ziffer)) continue;

    const bezeichnung = parts[1]?.trim() || ziffer;
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

    map.set(ziffer, { punkte, schwellenfaktor, hoechstfaktor, bezeichnung });
  }

  return map;
}

let _katalogCache: Map<string, KatalogEintrag> | null = null;

function getKatalogMap(): Map<string, KatalogEintrag> {
  if (!_katalogCache) {
    _katalogCache = parseKatalogEintrag(GOAE_KATALOG);
  }
  return _katalogCache;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

export interface ServiceBillingInput {
  /** Bei Dateien: Behandlungsbericht parsen; bei reinem Text: null */
  files?: FilePayload[];
  /** Nutzer-Nachricht (immer vorhanden, bei reinem Text = Hauptinhalt) */
  userMessage: string;
  model: string;
  extraRules?: string;
  /** Optimierungsziele aus Input-Parser (z.B. "maximal abrechnen" → maximaler_umsatz) */
  optimizeFor?: OptimizeFor[];
}

export async function runServiceBillingPipeline(
  input: ServiceBillingInput,
  apiKey: string,
): Promise<ServiceBillingResult> {
  let parsedRechnung: ParsedRechnung;

  if (input.files && input.files.length > 0) {
    parsedRechnung = await parseBehandlungsbericht(
      input.files,
      apiKey,
      input.model,
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

  const mappings = await mappeGoae(
    parsedRechnung,
    leistungen,
    medizinischeAnalyse,
    apiKey,
    input.model,
  );

  const katalog = getKatalogMap();
  const {
    excludedZiffern,
    begruendungVorschlaege,
    zusammenfassung: regelZusammenfassung,
  } = pruefeServiceBillingVorschlaege(
    mappings.zuordnungen,
    medizinischeAnalyse,
    GOAE_KATALOG,
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
          GOAE_KATALOG,
        );
      } else {
        begruendung = `Standardfaktor ${faktor}× (Schwellenwert) – keine Begründung erforderlich.`;
      }

      return {
        ziffer: z.ziffer,
        bezeichnung: z.bezeichnung,
        faktor,
        betrag,
        begruendung,
        leistung: z.leistung,
        konfidenz: z.konfidenz,
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
          GOAE_KATALOG,
        );
      } else {
        begruendung = `Alternative zu GOÄ ${z.ziffer} (${z.bezeichnung}). Standardfaktor ${faktor}× (Schwellenwert) – keine Begründung erforderlich.`;
      }

      optimierungen.push({
        ziffer: altZiffer,
        bezeichnung: eintrag.bezeichnung,
        faktor,
        betrag,
        begruendung,
        leistung: `Alternative zu ${z.leistung}`,
        konfidenz: "mittel",
      });
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
      // #region agent log
      fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "518e10" },
        body: JSON.stringify({
          sessionId: "518e10",
          location: "service-billing-orchestrator.ts:start",
          message: "Service billing started",
          data: { hasFiles: !!(input.files?.length) },
          timestamp: Date.now(),
          hypothesisId: "A,B",
        }),
      }).catch(() => {});
      // #endregion
      await sendProgress(0, SERVICE_BILLING_STEPS[0].label);
      const result = await runServiceBillingPipeline(input, apiKey);
      await sendProgress(SERVICE_BILLING_STEPS.length - 1, SERVICE_BILLING_STEPS[SERVICE_BILLING_STEPS.length - 1].label);

      const resultData = `data: ${JSON.stringify({
        type: "service_billing_result",
        data: result,
      })}\n\n`;
      await writer.write(encoder.encode(resultData));

      const introText = `Basierend auf Ihren Angaben schlage ich folgende GOÄ-Positionen vor. Wählen Sie aus, was Sie abrechnen möchten.\n\n`;
      await writer.write(encoder.encode(`data: ${JSON.stringify({
        choices: [{ delta: { content: introText } }],
      })}\n\n`));

      await writer.close();
      // #region agent log
      fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "518e10" },
        body: JSON.stringify({
          sessionId: "518e10",
          location: "service-billing-orchestrator.ts:ok",
          message: "Service billing completed",
          data: { vorschlaegeCount: result.vorschlaege?.length ?? 0 },
          timestamp: Date.now(),
          hypothesisId: "B",
        }),
      }).catch(() => {});
      // #endregion
    } catch (error) {
      console.error("Service billing error:", error);
      // #region agent log
      fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "518e10" },
        body: JSON.stringify({
          sessionId: "518e10",
          location: "service-billing-orchestrator.ts:error",
          message: "Service billing error",
          data: { error: error instanceof Error ? error.message : String(error) },
          timestamp: Date.now(),
          hypothesisId: "B,D",
        }),
      }).catch(() => {});
      // #endregion
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
