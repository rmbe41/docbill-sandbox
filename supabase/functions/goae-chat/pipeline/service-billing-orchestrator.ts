/**
 * Service-Billing-Orchestrator
 *
 * Pipeline für "Leistungen abrechnen": Nutzer beschreibt erbrachte Leistungen
 * (Text oder Behandlungsbericht) → System schlägt GOÄ-Positionen vor.
 *
 *   Text/Dokument → NLP → Leistungs-Extraktion → GOÄ-Mapping → Vorschläge
 */

import { parseBehandlungsbericht } from "./dokument-parser.ts";
import { analysiereMedizinisch } from "./medizinisches-nlp.ts";
import { mappeGoae } from "./goae-mapping.ts";
import { GOAE_KATALOG } from "../goae-catalog.ts";
import type {
  ParsedRechnung,
  ExtrahierteLeistung,
  MedizinischeAnalyse,
  GoaeZuordnung,
  FilePayload,
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

export interface ServiceBillingResult {
  vorschlaege: ServiceBillingPosition[];
  klinischerKontext: string;
  fachgebiet: string;
}

/** Parst Katalog-Zeile für Punkte und Schwellenfaktor */
function parseKatalogEintrag(katalogText: string): Map<string, { punkte: number; schwellenfaktor: number }> {
  const map = new Map<string, { punkte: number; schwellenfaktor: number }>();

  for (const line of katalogText.split("\n")) {
    const trimmed = line.trim();
    const parts = trimmed.split("|");
    if (parts.length < 5) continue;

    const ziffer = parts[0].trim();
    if (!ziffer || !/^[\dA]/.test(ziffer)) continue;

    const punkte = parseInt(parts[2]?.trim() || "0", 10);
    if (isNaN(punkte) || punkte === 0) continue;

    let schwellenfaktor = 2.3;
    const schwelleMatch = parts[4]?.match(/([\d,]+)→/);
    if (schwelleMatch) {
      schwellenfaktor = parseFloat(schwelleMatch[1].replace(",", "."));
    }

    map.set(ziffer, { punkte, schwellenfaktor });
  }

  return map;
}

let _katalogCache: Map<string, { punkte: number; schwellenfaktor: number }> | null = null;

function getKatalogMap(): Map<string, { punkte: number; schwellenfaktor: number }> {
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

/** Extrahiert Leistungen nur aus NLP (Behandlungen), ohne Rechnungspositionen */
function extrahiereLeistungenAusNlp(analyse: MedizinischeAnalyse): ExtrahierteLeistung[] {
  return analyse.behandlungen.map((b) => ({
    bezeichnung: b.text,
    beschreibung: `${b.text} (${b.typ})`,
    quelleBehandlung: b.text,
  }));
}

export interface ServiceBillingInput {
  /** Bei Dateien: Behandlungsbericht parsen; bei reinem Text: null */
  files?: FilePayload[];
  /** Nutzer-Nachricht (immer vorhanden, bei reinem Text = Hauptinhalt) */
  userMessage: string;
  model: string;
  extraRules?: string;
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

  if (leistungen.length === 0) {
    return {
      vorschlaege: [],
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

  const vorschlaege: ServiceBillingPosition[] = mappings.zuordnungen.map(
    (z: GoaeZuordnung) => {
      const faktor = 2.3;
      const betrag = berechneBetrag(z.ziffer, faktor);
      return {
        ziffer: z.ziffer,
        bezeichnung: z.bezeichnung,
        faktor,
        betrag,
        begruendung: z.istAnalog ? z.analogBegruendung : undefined,
        leistung: z.leistung,
        konfidenz: z.konfidenz,
      };
    },
  );

  return {
    vorschlaege,
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

      const introText = `Basierend auf Ihren Angaben schlage ich folgende GOÄ-Positionen vor. Wählen Sie aus, was Sie abrechnen möchten.\n\n`;
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
