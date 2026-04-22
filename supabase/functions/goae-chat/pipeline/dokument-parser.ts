/**
 * Step 1 – Dokument Parser
 *
 * Extrahiert strukturierte Daten aus einer Rechnung (PDF/Bild).
 * Nutzt einen fokussierten LLM-Aufruf mit JSON-Output.
 *
 *   Rechnung (PDF/Bild) → LLM → ParsedRechnung (JSON)
 */

import { callLlm, extractJson, pickExtractionModel } from "./llm-client.ts";
import { buildFallbackModels } from "../model-resolver.ts";
import type { FilePayload, ParsedRechnung } from "./types.ts";

/** Prüft ob das Parse-Ergebnis plausibel ist. Unplausibel = leere Positionen bei vorhandenem Text/Dokument. */
export function isPlausibleParseResult(
  parsed: ParsedRechnung,
  hasFiles: boolean,
): boolean {
  if (parsed.positionen.length > 0) return true;
  if (!hasFiles && (parsed.rawText?.length ?? 0) < 200) return true;
  return false;
}

/** Genug Text für eine zweite Extraktionsrunde (nur Text → JSON), vgl. isPlausibleParseResult. */
const MIN_RAW_TEXT_FOR_POSITION_EXTRACT = 200;

const POSITIONEN_FROM_RAWTEXT_PROMPT = `Du extrahierst alle GOÄ-Rechnungspositionen aus dem gegebenen Rohtext einer ärztlichen Rechnung.

Antworte AUSSCHLIESSLICH mit JSON:
{
  "positionen": [
    {
      "nr": 1,
      "ziffer": "1240",
      "bezeichnung": "…",
      "faktor": 2.3,
      "betrag": 9.92,
      "datum": "2025-01-15 oder weglassen",
      "begruendung": null,
      "anzahl": 1
    }
  ]
}

REGELN:
- Eine Position pro abrechenbarer Zeile / Leistung mit erkennbarer oder ableitbarer GOÄ-Ziffer
- ziffer als String, faktor und betrag numerisch (Punkt als Dezimaltrenner)
- Wirklich keine Positionen erkennbar: "positionen": []`;

const POSITIONEN_EBM_FROM_RAWTEXT_PROMPT = `Du extrahierst alle GKV-Abrechnungspositionen (EBM) aus dem gegebenen Rohtext (Honorar, GOÄ-ähnliches Layout oder Abrechnungsbeleg).

Antworte AUSSCHLIESSLICH mit JSON:
{
  "positionen": [
    {
      "nr": 1,
      "ziffer": "01100",
      "bezeichnung": "Kurzbezeichnung",
      "faktor": 1.0,
      "betrag": 24.97,
      "datum": "2025-01-15 oder weglassen",
      "begruendung": null,
      "anzahl": 1
    }
  ]
}

REGELN:
- "ziffer" = 5-stellige GOP (String, z. B. "01100")
- "faktor" = bei EBM in der Regel 1,0, sofern die Rechnung keinen Faktor ausweist
- "betrag" = Euro der Zeile (Punkt als Dezimaltrenner)
- Wirklich keine EBM-Positionen erkennbar: "positionen": []`;

/**
 * Vision/PDF-Parser liefert oft rawText, aber leeres positionen-Array. Zweiter Aufruf nur mit Text
 * (gleiches Nutzer-Modell, keine Multimodal-Fallbacks) behebt das ohne andere Modelle.
 */
async function tryFillPositionenFromRawText(
  parsed: ParsedRechnung,
  apiKey: string,
  model: string,
  regelwerk: "GOAE" | "EBM" = "GOAE",
): Promise<ParsedRechnung> {
  if (parsed.positionen.length > 0) return parsed;
  const raw = (parsed.rawText || "").trim();
  if (raw.length < MIN_RAW_TEXT_FOR_POSITION_EXTRACT) return parsed;

  const truncated =
    raw.length > 120_000 ? `${raw.slice(0, 120_000)}\n\n[… Text gekürzt …]` : raw;

  try {
    const rawLlm = await callLlm({
      apiKey,
      model,
      systemPrompt: regelwerk === "EBM" ? POSITIONEN_EBM_FROM_RAWTEXT_PROMPT : POSITIONEN_FROM_RAWTEXT_PROMPT,
      userContent: [
        {
          type: "text",
          text: `Rohtext der Rechnung:\n\n${truncated}`,
        },
      ],
      jsonMode: true,
      temperature: 0.05,
      maxTokens: 8192,
      skipFallbacks: true,
    });
    const partial = extractJson<{ positionen?: ParsedRechnung["positionen"] }>(rawLlm);
    if (!Array.isArray(partial.positionen) || partial.positionen.length === 0) {
      return parsed;
    }
    for (let i = 0; i < partial.positionen.length; i++) {
      const pos = partial.positionen[i];
      pos.anzahl = pos.anzahl || 1;
      pos.ziffer = String(pos.ziffer ?? "");
      if (pos.nr == null || Number.isNaN(Number(pos.nr))) pos.nr = i + 1;
    }
    return { ...parsed, positionen: partial.positionen };
  } catch {
    return parsed;
  }
}

const PARSER_SYSTEM_PROMPT = `Du bist ein Dokumentenparser für ärztliche Rechnungen nach der Gebührenordnung für Ärzte (GOÄ).

AUFGABE: Extrahiere ALLE strukturierten Daten aus dem hochgeladenen Rechnungsdokument – inklusive Stammdaten für den Rechnungsexport.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in diesem Format:

{
  "positionen": [
    {
      "nr": 1,
      "ziffer": "1240",
      "bezeichnung": "Spaltlampenmikroskopie",
      "faktor": 2.3,
      "betrag": 9.92,
      "datum": "2025-01-15",
      "begruendung": null,
      "anzahl": 1
    }
  ],
  "diagnosen": ["Verdacht auf Glaukom", "Katarakt beidseits"],
  "datum": "2025-01-15",
  "freitext": "Befundbericht: ...",
  "rawText": "der komplette Text des Dokuments",
  "stammdaten": {
    "praxis": { "name": "Dr. med. Beispiel", "adresse": "Musterstr. 1, 12345 Stadt", "telefon": "0123/456789", "email": "praxis@example.de", "steuernummer": "12/345/67890" },
    "patient": { "name": "Max Mustermann", "adresse": "Patientenstr. 1, 12345 Stadt", "geburtsdatum": "01.01.1980" },
    "bank": { "iban": "DE89 3704 0044 0532 0130 00", "bic": "COBADEFFXXX", "bankName": "Commerzbank", "kontoinhaber": "Dr. med. Beispiel" },
    "rechnungsnummer": "RE-2025-001",
    "rechnungsdatum": "2025-01-15"
  }
}

REGELN:
- "ziffer": die GOÄ-Ziffernummer als String (z.B. "1240", "5", "A7011")
- "faktor": numerischer Steigerungsfaktor (z.B. 2.3, 1.8, 3.5)
- "betrag": Euro-Betrag als Dezimalzahl (z.B. 9.92)
- "anzahl": Wie oft die Leistung abgerechnet wird (Standard: 1)
- "begruendung": falls eine Begründung für den Steigerungsfaktor angegeben ist
- "diagnosen": Liste aller genannten Diagnosen/Befunde
- "rawText": der gesamte extrahierte Text des Dokuments
- "stammdaten": Extrahiere ALLE Stammdaten aus der Rechnung – Praxis (Name, Adresse, Telefon, E-Mail, Steuernummer), Patient (Name, Adresse, Geburtsdatum), Bankverbindung (IBAN, BIC, Bankname, Kontoinhaber), Rechnungsnummer, Rechnungsdatum. Fehlende Felder als null oder weglassen.
- Bei unleserlichen Stellen: bestmögliche Interpretation, im freitext vermerken`;

const PARSER_SYSTEM_PROMPT_EBM = `Du bist ein Dokumentenparser für ärztliche bzw. vertragsärztliche Abrechnungsbelege nach dem **EBM** (GKV, GOPs fünf Stellen).

AUFGABE: Extrahiere ALLE strukturierten Daten – inklusive Stammdaten für den Rechnungsexport.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in diesem Format:

{
  "positionen": [
    {
      "nr": 1,
      "ziffer": "01100",
      "bezeichnung": "Unvorhergesehene Inanspruchnahme …",
      "faktor": 1.0,
      "betrag": 24.97,
      "datum": "2025-01-15",
      "begruendung": null,
      "anzahl": 1
    }
  ],
  "diagnosen": ["…"],
  "datum": "2025-01-15",
  "freitext": "…",
  "rawText": "der komplette Text des Dokuments",
  "stammdaten": { "praxis": { "name": null, "adresse": null, "telefon": null, "email": null, "steuernummer": null }, "patient": { "name": null, "adresse": null, "geburtsdatum": null }, "bank": { "iban": null, "bic": null, "bankName": null, "kontoinhaber": null }, "rechnungsnummer": null, "rechnungsdatum": null }
}

REGELN:
- "ziffer": fünf stellige **GOP** (String, z. B. "01100", "12345")
- "faktor": bei EBM meist 1,0, außer der Beleg nennt ausdrücklich etwas anderes
- "betrag": Euro (Dezimalpunkt)
- "anzahl": Standard 1, falls nicht anders ersichtlich
- "rawText" und "stammdaten" wie bei GOÄ-Parsing
- Keine GOÄ-Dreisteller als ziffer verwenden, wenn es sich um eine GKV-EBM-Abrechnung handelt.`;

/** Mehrere Dateien: Honorarrechnung vs. Akte/Befund trennen (Rechnungsprüfung). */
const MULTI_DOC_INVOICE_REVIEW_PROMPT = `Du bist ein Dokumentenparser für die **Rechnungsprüfung**, wenn **mehrere Dateien** vorliegen.

Typische Kombination: eine **ärztliche Honorarrechnung** (GOÄ) und optional **Patientenakte**, **Befund**, **Arztbrief** oder OP-/Ambulanzbericht.

Antworte AUSSCHLIESSLICH mit JSON:

{
  "positionen": [
    {
      "nr": 1,
      "ziffer": "1240",
      "bezeichnung": "…",
      "faktor": 2.3,
      "betrag": 9.92,
      "datum": "2025-01-15",
      "begruendung": null,
      "anzahl": 1
    }
  ],
  "diagnosen": [],
  "datum": "optional",
  "freitext": "optional Kurznotiz",
  "rawText": "Wesentlicher Gesamttext; Rechnungs- und Aktenanteile im Fließtext klar erkennbar",
  "stammdaten": {
    "praxis": { "name": null, "adresse": null, "telefon": null, "email": null, "steuernummer": null },
    "patient": { "name": null, "adresse": null, "geburtsdatum": null },
    "bank": { "iban": null, "bic": null, "bankName": null, "kontoinhaber": null },
    "rechnungsnummer": null,
    "rechnungsdatum": null
  },
  "klinischeDokumentation": "Auszug oder Volltext aus Akte/Befund/Arztbrief – keine Honorarzeilen. Leerer String, wenn nur eine Rechnung ohne separates klinisches Dokument vorliegt."
}

REGELN:
- **positionen**, **stammdaten** (Praxis/Bank/Rechnungsnummer): **nur** aus der **Honorarrechnung** bzw. Abrechnungsbeleg – nichts aus der Akte als Rechnungsposition erfinden.
- **klinischeDokumentation**: dokumentierte Leistungen, Befunde, Verläufe aus **nicht-Rechnungs**-Unterlagen; mehrere solcher Dateien zu einem zusammenhängenden Text zusammenführen.
- **diagnosen**: soweit aus Rechnung oder Akte erkennbar.
- **rawText**: darf beide Quellen enthalten; **klinischeDokumentation** soll den klinischen Teil für die spätere GOÄ-Bewertung tragfähig wiedergeben.
- Bei unleserlichen Stellen: bestmögliche Interpretation, im freitext vermerken.`;

const MULTI_DOC_INVOICE_REVIEW_EBM = `Du bist ein Dokumentenparser für die **Rechnungsprüfung** (EBM / GKV), wenn **mehrere Dateien** vorliegen.

Typische Kombination: **Abrechnungsbeleg** (GOP, Euro) und optional **Akte/Befund/Arztbrief**.

Antworte mit dem gleichen JSON-Schema wie im Einzeldatei-EBM-Parser, plus **klinischeDokumentation** (nur Nicht-Rechnung).

**positionen**: nur fünf stellige GOPs; Faktor meist 1,0. **rawText** darf beide Quellen tragen.`;

export type ParseDokumentExtraOptions = {
  multiDocumentInvoiceReview?: boolean;
  /** EBM: GOP statt GOÄ; Prompts PARSER_SYSTEM_PROMPT_EBM. */
  regelwerk?: "GOAE" | "EBM";
};

export async function parseDokument(
  files: FilePayload[],
  apiKey: string,
  userModel: string,
  modelOverride?: string,
  parseOpts?: ParseDokumentExtraOptions,
): Promise<ParsedRechnung> {
  const model = modelOverride ?? pickExtractionModel(userModel);
  const multiReview = !!parseOpts?.multiDocumentInvoiceReview && files.length >= 2;
  const ebm = parseOpts?.regelwerk === "EBM";
  const systemParser = multiReview
    ? (ebm ? MULTI_DOC_INVOICE_REVIEW_EBM : MULTI_DOC_INVOICE_REVIEW_PROMPT)
    : (ebm ? PARSER_SYSTEM_PROMPT_EBM : PARSER_SYSTEM_PROMPT);

  const contentParts: unknown[] = [
    {
      type: "text",
      text: multiReview
        ? "Analysiere alle angehängten Dateien. Trenne Honorarrechnung (Positionen, Stammdaten) und klinische Unterlagen (klinischeDokumentation). Antworte nur als JSON."
        : "Lies dieses Rechnungsdokument vollständig aus und extrahiere alle Positionen, Diagnosen und relevanten Informationen als JSON.",
    },
  ];

  for (const file of files) {
    const mimeType = file.type || "application/octet-stream";
    if (mimeType === "application/pdf") {
      contentParts.push({
        type: "file",
        file: {
          filename: file.name,
          file_data: `data:application/pdf;base64,${file.data}`,
        },
      });
    } else {
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${file.data}` },
      });
    }
  }

  const hasPdf = files.some((f) => (f.type || "").includes("pdf"));
  const plugins: unknown[] = [{ id: "response-healing" }];
  if (hasPdf) {
    plugins.push({ id: "file-parser", pdf: { engine: "mistral-ocr" } });
  }

  const raw = await callLlm({
    apiKey,
    model,
    systemPrompt: systemParser,
    userContent: contentParts,
    jsonMode: true,
    temperature: 0.05,
    maxTokens: 8192,
    plugins,
    skipFallbacks: !!modelOverride,
  });

  const parsed = extractJson<ParsedRechnung>(raw);

  if (!parsed.positionen) parsed.positionen = [];
  if (!parsed.diagnosen) parsed.diagnosen = [];
  if (!parsed.rawText) parsed.rawText = "";
  if (multiReview && typeof parsed.klinischeDokumentation !== "string") {
    parsed.klinischeDokumentation = "";
  }

  for (const pos of parsed.positionen) {
    pos.anzahl = pos.anzahl || 1;
    pos.ziffer = String(pos.ziffer);
  }

  return parsed;
}

const MAX_PARSER_RETRIES = 3;

/** Parser für Behandlungsberichte/Arztbriefe (keine Rechnung).
 * Extrahiert rawText und diagnosen, positionen bleiben leer. */
const BEHANDLUNGSBERICHT_PROMPT = `Du bist ein Dokumentenparser für medizinische Behandlungsberichte und Arztbriefe.

AUFGABE: Extrahiere den vollständigen Text und alle genannten Diagnosen/Befunde aus dem Dokument.
Dies ist KEIN Rechnungsdokument, sondern ein Behandlungsbericht, Befund oder Arztbrief.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt:

{
  "positionen": [],
  "diagnosen": ["Diagnose 1", "Diagnose 2"],
  "rawText": "der komplette Text des Dokuments",
  "freitext": "optional: Befundzusammenfassung"
}

REGELN:
- positionen: IMMER leeres Array (keine Abrechnungspositionen)
- rawText: der gesamte extrahierte Text
- diagnosen: alle genannten Diagnosen, Befunde, Verdachtsdiagnosen`;

function withAdminContextPrompt(base: string, adminContext?: string): string {
  const a = adminContext?.trim();
  if (!a) return base;
  return `${base}\n\n## ADMIN-KONTEXT (Praxis-/Klinik-Wissen):\n${a}`;
}

export async function parseBehandlungsbericht(
  files: FilePayload[],
  apiKey: string,
  userModel: string,
  adminContext?: string,
): Promise<ParsedRechnung> {
  const model = pickExtractionModel(userModel);

  const contentParts: unknown[] = [
    {
      type: "text",
      text: "Lies dieses medizinische Dokument vollständig aus und extrahiere den Text sowie alle Diagnosen als JSON.",
    },
  ];

  for (const file of files) {
    const mimeType = file.type || "application/octet-stream";
    if (mimeType === "application/pdf") {
      contentParts.push({
        type: "file",
        file: {
          filename: file.name,
          file_data: `data:application/pdf;base64,${file.data}`,
        },
      });
    } else {
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${file.data}` },
      });
    }
  }

  const hasPdf = files.some((f) => (f.type || "").includes("pdf"));
  const plugins: unknown[] = [{ id: "response-healing" }];
  if (hasPdf) {
    plugins.push({ id: "file-parser", pdf: { engine: "mistral-ocr" } });
  }

  const raw = await callLlm({
    apiKey,
    model,
    systemPrompt: withAdminContextPrompt(BEHANDLUNGSBERICHT_PROMPT, adminContext),
    userContent: contentParts,
    jsonMode: true,
    temperature: 0.05,
    maxTokens: 8192,
    plugins,
  });

  const parsed = extractJson<ParsedRechnung>(raw);
  if (!parsed.positionen) parsed.positionen = [];
  if (!parsed.diagnosen) parsed.diagnosen = [];
  if (!parsed.rawText) parsed.rawText = "";

  return parsed;
}

/** Ruft parseDokument mit Retry auf, bis das Ergebnis plausibel ist oder alle Modelle durch sind. */
export async function parseDokumentWithRetry(
  files: FilePayload[],
  apiKey: string,
  userModel: string,
  parseOpts?: ParseDokumentExtraOptions,
): Promise<ParsedRechnung> {
  const modelsToTry = buildFallbackModels(userModel, { multimodal: true });
  const hasFiles = files.length > 0;
  let lastError: Error | null = null;

  for (let i = 0; i < Math.min(MAX_PARSER_RETRIES, modelsToTry.length); i++) {
    const model = modelsToTry[i];
    try {
      let parsed = await parseDokument(files, apiKey, userModel, model, parseOpts);
      if (!isPlausibleParseResult(parsed, hasFiles)) {
        parsed = await tryFillPositionenFromRawText(
          parsed,
          apiKey,
          model,
          parseOpts?.regelwerk === "EBM" ? "EBM" : "GOAE",
        );
      }
      if (isPlausibleParseResult(parsed, hasFiles)) {
        return parsed;
      }
      lastError = new Error(
        `Parser lieferte leere Positionen trotz ${hasFiles ? "hochgeladenem Dokument" : "vorhandenem Text"}.`,
      );
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw lastError ?? new Error("Parser-Retry fehlgeschlagen.");
}
