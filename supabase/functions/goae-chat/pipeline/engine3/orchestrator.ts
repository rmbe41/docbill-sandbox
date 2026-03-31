/**
 * Engine 3 – eigenständige SSE-Pipeline (Rechnungsprüfung + Leistungsabrechnung).
 */

import {
  enrichRagQueryForAuslegung,
  loadRelevantAdminContext,
  buildPipelineQuery,
  preflightEngine3KiContext,
  type LastResultContext,
} from "../../admin-context.ts";
import { GOAE_PARAGRAPHEN_KOMPAKT } from "../../goae-paragraphen.ts";
import {
  GOAE_ABSCHNITTE_KOMPAKT,
  GOAE_ANALOGE_BEWERTUNG,
  GOAE_BEGRUENDUNGEN,
  GOAE_SONDERBEREICHE_KOMPAKT,
} from "../../goae-regeln.ts";
import { buildMappingCatalogMarkdown } from "../../goae-catalog-json.ts";
import { parseDokumentWithRetry, parseBehandlungsbericht } from "../dokument-parser.ts";
import { analysiereMedizinisch } from "../medizinisches-nlp.ts";
import { callLlm, extractJson, pickExtractionModel } from "../llm-client.ts";
import { buildFallbackModels } from "../../model-resolver.ts";
import type { FilePayload, ParsedRechnung } from "../types.ts";
import { buildEngine3AssistantMarkdown } from "./markdown-narrative.ts";
import {
  applyEngine3AusschlussPass,
  applyRecalcAndConsistency,
  enforceEngine3Quellenbezug,
  parseEngine3ResultJson,
  toClientEngine3Result,
  type Engine3Modus,
  type Engine3ResultData,
} from "./validate.ts";

class Engine3ParseError extends Error {
  readonly parseDebug: Record<string, unknown>;
  constructor(message: string, parseDebug: Record<string, unknown>) {
    super(message);
    this.name = "Engine3ParseError";
    this.parseDebug = parseDebug;
  }
}

const ENGINE3_STEPS = [
  { label: "KI-Kontext wird geprüft …" },
  { label: "Dokument und Freitext werden analysiert …" },
  { label: "GOÄ-Katalog und Admin-Kontext werden geladen …" },
  { label: "Ergebnis wird erstellt …" },
  { label: "Beträge und Plausibilität werden geprüft …" },
];

const GOAE_STAND_HINWEIS =
  "GOÄ-Ziffern und Punktwerte nach DocBill-Katalog (JSON); Punktwert 0,0582873 EUR.";

export interface Engine3StreamInput {
  modus: Engine3Modus;
  files?: FilePayload[];
  userMessage: string;
  conversationHistory?: { role: string; content: string }[];
  model: string;
  extraRules?: string;
  lastResult?: LastResultContext;
  /** Rohes letztes Engine-3-Ergebnis für Follow-up-Kontext (optional, JSON vom Client) */
  lastEngine3Result?: unknown;
}

function extractAdminFilenamesFromBlock(adminBlock: string): string[] {
  const names: string[] = [];
  const re = /^###\s+([^\n(]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(adminBlock)) !== null) {
    const n = m[1]?.trim();
    if (n && !names.includes(n)) names.push(n);
  }
  return names.slice(0, 12);
}

/** Einheitliche, systemseitige Quellenliste für UI und Nachvollziehbarkeit (nicht modell-halluziniert). */
function buildEngine3SystemQuellen(input: Engine3StreamInput, data: Engine3ResultData): string[] {
  const lines: string[] = [
    "GOÄ-Paragraphen und Bewertungsregeln (eingebetteter DocBill-Referenzblock)",
    "GOÄ-Ziffern und Punktwerte (kontextbezogener Katalogauszug, DocBill JSON)",
  ];
  const nFiles = input.files?.length ?? 0;
  if (nFiles > 0) {
    lines.push(`Eingabe: hochgeladene Datei(en) (${nFiles})`);
  } else if (input.modus === "leistungen_abrechnen") {
    lines.push("Eingabe: Freitext der Nutzeranfrage (ohne Dateiupload)");
  }
  const seen = new Set(lines);
  for (const a of data.adminQuellen ?? []) {
    const t = String(a).trim();
    const row = `Interner Kontext (RAG): ${t}`;
    if (t && !seen.has(row)) {
      seen.add(row);
      lines.push(row);
    }
  }
  return lines;
}

function rechnungPruefungPrompt(
  parsedJson: string,
  analyseJson: string,
  katalogMd: string,
  adminContext: string,
  extraRules: string,
): string {
  return `Du bist GOÄ-DocBill Engine 3. Modus: **Rechnungsprüfung**.

Du erhältst extrahierte Rechnungsdaten (JSON), optional **klinischeDokumentation** (Patientenakte/Befund/Arztbrief), und eine medizinische Kurzanalyse (JSON). Du MUSST:
- nur Ziffern und Punktwerte verwenden, die im GOÄ-Katalogauszug (Markdown) vorkommen
- fehlende Information klar benennen, nichts erfinden
- Positionen mit Status klassifizieren: korrekt | warnung | fehler
- konkrete Hinweise (fehler/warnung/info) mit kurzer Begründung
- sinnvolle Optimierungs-Vorschläge (regelkonform) als eigene Positionen mit status "vorschlag", falls zutreffend
- wenn **klinischeDokumentation** nicht leer ist: daraus ableiten, welche Leistungen **im Rahmen des Katalogs und Kontexts** abrechenbar wären; mit den **tatsächlichen Rechnungspositionen** abgleichen; fehlende oder zu hohe/niedrige Abrechnung sowie Diskrepanzen in **hinweise** und ggf. **optimierungen** benennen (keine erfundenen Leistungen)
- jede Position **quelleText**: kurzer Bezug zur Rechnungszeile, zur Positionsnummer im Rechnungstext oder zu einem passenden Ausschnitt aus **klinischeDokumentation** (Pflichtfeld, nicht leer)

**Pflicht-Checkliste**
- Ziffern/Bezeichnungen/Punkte: nur aus dem Katalogauszug; fehlende Ziffer → in **hinweise**, nichts erfinden.
- **Ausschlüsse:** Jede Kombination von Positionsziffern anhand der **Ausschl:**-Angaben der Katalogzeilen prüfen; Konflikt → **hinweise** (schwere fehler/warnung) mit **regelReferenz** „Ausschlussziffern GOÄ-Katalog“.
- **Steigerung:** Schwellen-/Höchstfaktor aus Katalogzeile; über Schwelle → **begruendung** mit konkretem Sachbezug (Dauer Min., Erschwernis), § 5 Abs. 2 GOÄ; keine Leerformeln (siehe Regelblock Begründungen).
- **Sonderbereiche** (Leichenschau, Zuschläge, Akupunktur): nur, wenn die Ziffer im Auszug steht; sonst Lücke in **hinweise**.
- **BÄK / Auslegung / GOÄ-Kommentar:** Nur mit konkretem Nachweis im **ADMIN-KONTEXT** (Dateiname); jede inhaltlich verwendete Admin-Datei **mindestens einmal** in **adminQuellen** (kurzer Dateiname) aufführen. Ohne Treffer: Unsicherheit in **hinweise**, nichts erfinden.
- **Hinweise:** Behauptet ein Eintrag eine konkrete Regel oder Auslegung, **muss** **regelReferenz** gesetzt sein (z. B. „GOÄ-Katalogauszug, Ziffer …“ oder „ADMIN-KONTEXT: [Dateiname]“).
- **Hinweis-Zuordnung:** Betrifft ein Hinweis konkrete Tabellenzeilen, setze **betrifftPositionen** als Array der zugehörigen **nr**-Werte aus **positionen** oder **optimierungen**; bei rein allgemeinen Hinweisen weglassen oder leeres Array.

**System-Nachbearbeitung (verbindlich):** Nach deiner Antwort wendet DocBill **deterministische** Prüfungen an (u. a. Ausschlusspaare, Beträge aus Punkten × Punktwert). Dieses Ergebnis ist **maßgeblich**. Setze **keine** Position auf **korrekt**, wenn der Katalogausschnitt einen Ausschlusszwang zu einer anderen abgerechneten Ziffer zeigt; verwende **fehler**/**warnung** und passende **hinweise**. Widerspricht dein Entwurf dem Katalog, korrigiere ihn vor der Ausgabe.

Antworte NUR mit JSON im folgenden Schema:
{
  "klinischerKontext": "2–4 Sätze, nur aus den Eingabedaten",
  "fachgebiet": "string",
  "positionen": [
    {
      "nr": 1,
      "ziffer": "…",
      "bezeichnung": "…",
      "faktor": 2.3,
      "betrag": 0.0,
      "status": "korrekt|warnung|fehler",
      "anmerkung": "optional",
      "quelleText": "Pflicht: Bezug zur Rechnungszeile / Position im Text / klinischeDokumentation",
      "begruendung": "optional bei hohem Faktor"
    }
  ],
  "hinweise": [
    { "schwere": "fehler|warnung|info", "titel": "kurz", "detail": "1–3 Sätze", "regelReferenz": "optional", "betrifftPositionen": [1, 2] }
  ],
  "optimierungen": [],
  "adminQuellen": []
}

Leeres optimierungen-Array, wenn nichts Sinnvolles.

Eingabe Rechnung (JSON):
${parsedJson}

Eingabe medizinische Analyse (JSON):
${analyseJson}

${extraRules ? `## ZUSÄTZLICHE REGELN:\n${extraRules}\n` : ""}

${adminContext ? `${adminContext}\n` : ""}

## GOÄ-KATALOG (Auszug)
${katalogMd}
`;
}

function leistungenPrompt(
  parsedJson: string,
  analyseJson: string,
  katalogMd: string,
  adminContext: string,
  extraRules: string,
): string {
  return `Du bist GOÄ-DocBill Engine 3. Modus: **Leistungen abrechnen** (Aus Text/Akte Vorschläge).

Erstelle eine regelkonforme GOÄ-Liste zur Abrechnung der dokumentierten Leistungen.
Nutze nur Ziffern aus dem Katalogauszug. Ordne jeder Position ein kurzes quelleText (Zitat/Paraphrase aus dem Dokument) zu.
Markiere unsichere Zuordnungen mit status "warnung" und erkläre in anmerkung.

**Pflicht-Checkliste**
- Nur Ziffern aus dem Katalogauszug; keine halluzinierten Nummern.
- **Ausschlüsse:** alle vorgeschlagenen Ziffern paarweise gegen die Ausschl-Angaben im Auszug prüfen; Konflikte → **hinweise** + ggf. Position „warnung“/„fehler“.
- **Steigerung:** Faktor innerhalb Katalograhmen; über Schwellenwert → ausführliche **begruendung** (§ 5 Abs. 2 GOÄ), konkret und prüfernah.
- **Sonderfälle** ( Leichenschau, Not-/Zeitzuschläge, Akupunktur): nur mit Ziffer im Auszug; sonst **hinweis** auf unvollständigen Kontext.
- **BÄK / GOÄ-Kommentar:** Nur wenn **ADMIN-KONTEXT** eine belegbare Fundstelle liefert; jede verwendete Admin-Datei in **adminQuellen** nennen. Behauptete Regeln in **hinweise** mit **regelReferenz** belegen („GOÄ-Katalogauszug …“ oder „ADMIN-KONTEXT: …“).
- **Hinweis-Zuordnung:** **betrifftPositionen**: **nr**-Werte der betroffenen Zeilen aus **positionen**/**optimierungen**; bei allgemeinen Hinweisen weglassen.

**System-Nachbearbeitung:** Deterministische Regeln (Ausschlüsse, Betrag aus Punkten) können dein JSON anpassen; das ausgelieferte Ergebnis entspricht diesem **finalen** Stand. Keine vorgeschlagenen Ziffernkombinationen widersprüchlich zum **Ausschl:** im Auszug ausgeben.

Antworte NUR mit JSON:
{
  "klinischerKontext": "2–4 Sätze",
  "fachgebiet": "string",
  "positionen": [
    {
      "nr": 1,
      "ziffer": "…",
      "bezeichnung": "…",
      "faktor": 2.3,
      "betrag": 0.0,
      "status": "korrekt|warnung|vorschlag",
      "anmerkung": "optional",
      "quelleText": "Pflicht: Bezug zum Leistungstext",
      "begruendung": "optional"
    }
  ],
  "hinweise": [ { "schwere": "info|warnung|fehler", "titel": "…", "detail": "…", "regelReferenz": "optional", "betrifftPositionen": [1] } ],
  "optimierungen": [],
  "adminQuellen": []
}

Dokument-/Freitext JSON:
${parsedJson}

Medizinische Analyse JSON:
${analyseJson}

${extraRules ? `## ZUSÄTZLICHE REGELN:\n${extraRules}\n` : ""}

${adminContext ? `${adminContext}\n` : ""}

## GOÄ-KATALOG (Auszug)
${katalogMd}
`;
}

const CRITIQUE_PROMPT = `Du prüfst ein bereits erzeugtes Engine-3-JSON auf Widersprüche zum GOÄ-Katalogausschnitt und zur Rechnungs-/Leistungslogik.
Gib das **vollständige korrigierte JSON** zurück (gleiche Keys, gleiche modus-Logik im Inhalt). Entferne unmögliche Ziffern. Korrigiere offensichtliche Doppelabrechnungen gemäß **Ausschl-** und Ausschluss-Hinweisen im Katalog (insb. Kombinationen, die sich gegenseitig ausschließen).
Auslegungsbehauptungen (BÄK, GOÄ-Kommentar) nur, wenn sie im **ADMIN-KONTEXT** mit Dateinamen belegbar sind; sonst entfernen oder durch ehrliche Unsicherheit in **hinweise** ersetzen. **adminQuellen** und **regelReferenz** in **hinweise** müssen zu echten Fundstellen passen.
Wenn unsicher: setze status auf warnung und erkläre in anmerkung.
Erhalte **quelleText** je Position (Rechnungsprüfung und Leistungsmodus); fehlt es, ergänze einen sachlichen Bezug zur Eingabe statt das Feld zu löschen.
Hinweis: Unmittelbar nach dieser Runde können **systemseitige** Regeln (Ausschlüsse, Betragsrechenregeln) das JSON nochmals anpassen – deine Ausgabe soll bereits mit dem Katalogausschnitt **konsistent** sein.
Erhalte **betrifftPositionen** an **hinweise**, wo sinnvoll (Array der **nr** der betroffenen Zeilen).`;

async function critiqueRefineIfNeeded(
  apiKey: string,
  userModel: string,
  data: Engine3ResultData,
  katalogMd: string,
): Promise<Engine3ResultData> {
  const model = pickExtractionModel(userModel);
  const body = JSON.stringify(data);
  if (body.length > 48_000) return data;

  try {
    const raw = await callLlm({
      apiKey,
      model,
      systemPrompt: `${CRITIQUE_PROMPT}\n\n## Katalog zur Prüfung:\n${katalogMd.slice(0, 24_000)}`,
      userContent: [
        {
          type: "text",
          text: `Zu prüfendes JSON:\n${body}`,
        },
      ],
      jsonMode: true,
      temperature: 0.05,
      maxTokens: 8192,
      skipFallbacks: true,
    });
    const parsed = extractJson<unknown>(raw);
    const next = parseEngine3ResultJson(parsed, data.modus);
    if (!next) return data;
    const adminMerged = [
      ...new Set([...(next.adminQuellen ?? []), ...(data.adminQuellen ?? [])]),
    ].slice(0, 12);
    return applyRecalcAndConsistency({
      ...next,
      goaeStandHinweis: next.goaeStandHinweis ?? data.goaeStandHinweis,
      ...(adminMerged.length ? { adminQuellen: adminMerged } : {}),
    });
  } catch {
    return data;
  }
}

function leistungstexteFromParsed(parsed: ParsedRechnung, userMessage: string): string[] {
  const texts: string[] = [userMessage, parsed.rawText ?? "", parsed.freitext ?? ""];
  if (parsed.klinischeDokumentation?.trim()) {
    texts.push(parsed.klinischeDokumentation);
  }
  for (const p of parsed.positionen) {
    texts.push(`${p.ziffer} ${p.bezeichnung}`);
  }
  for (const d of parsed.diagnosen ?? []) {
    texts.push(typeof d === "string" ? d : "");
  }
  return texts.filter((t) => t.trim().length > 0);
}

export async function runEngine3AsStream(input: Engine3StreamInput, apiKey: string): Promise<Response> {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  const sendProgress = async (step: number, label: string) => {
    const data = `data: ${JSON.stringify({
      type: "engine3_progress",
      step: step + 1,
      totalSteps: ENGINE3_STEPS.length,
      label,
    })}\n\n`;
    await writer.write(encoder.encode(data));
  };

  const sendError = async (
    message: string,
    code?: string,
    debug?: Record<string, unknown>,
  ) => {
    const payload: Record<string, unknown> = { type: "engine3_error", error: message };
    if (code) payload.code = code;
    if (debug && Object.keys(debug).length > 0) payload.debug = debug;
    await writer.write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  };

  (async () => {
    try {
      await sendProgress(0, ENGINE3_STEPS[0].label);
      await preflightEngine3KiContext(apiKey);

      await sendProgress(1, ENGINE3_STEPS[1].label);
      let parsed: ParsedRechnung;
      if (input.modus === "rechnung_pruefung") {
        if (!input.files?.length) {
          throw new Error("Für die Rechnungsprüfung wird eine Datei benötigt.");
        }
        parsed = await parseDokumentWithRetry(input.files, apiKey, input.model, {
          multiDocumentInvoiceReview: input.files.length >= 2,
        });
      } else {
        if (input.files?.length) {
          parsed = await parseBehandlungsbericht(input.files, apiKey, input.model);
        } else {
          parsed = {
            positionen: [],
            diagnosen: [],
            rawText: input.userMessage,
            freitext: input.userMessage,
          };
        }
      }

      const med = await analysiereMedizinisch(parsed, apiKey, input.model);

      await sendProgress(2, ENGINE3_STEPS[2].label);
      const mergeQuery = enrichRagQueryForAuslegung(
        buildPipelineQuery(
          input.userMessage,
          { medizinischeAnalyse: med, pruefung: undefined },
          input.lastResult,
        ),
      );
      const adminBlock = await loadRelevantAdminContext(mergeQuery, apiKey, {
        vectorQuery: enrichRagQueryForAuslegung(input.userMessage.trim() || mergeQuery),
      });
      const adminQuellenHint = extractAdminFilenamesFromBlock(adminBlock);

      const leistungTexts = leistungstexteFromParsed(parsed, input.userMessage);
      const katalogMd = buildMappingCatalogMarkdown({
        leistungTexts,
        fachgebiet: med.fachgebiet,
        maxLines: 200,
      });

      const staticGoae = [
        GOAE_PARAGRAPHEN_KOMPAKT,
        GOAE_ABSCHNITTE_KOMPAKT,
        GOAE_SONDERBEREICHE_KOMPAKT,
        GOAE_ANALOGE_BEWERTUNG,
        GOAE_BEGRUENDUNGEN,
      ].join("\n\n");

      await sendProgress(3, ENGINE3_STEPS[3].label);

      const klin = (parsed.klinischeDokumentation ?? "").trim();
      const parsedCompact = JSON.stringify({
        positionen: parsed.positionen,
        diagnosen: parsed.diagnosen,
        rawText:
          parsed.rawText.length > 25_000
            ? `${parsed.rawText.slice(0, 25_000)}\n… [gekuerzt]`
            : parsed.rawText,
        stammdaten: parsed.stammdaten,
        klinischeDokumentation:
          klin.length > 25_000 ? `${klin.slice(0, 25_000)}\n… [gekuerzt]` : klin,
      });
      const analyseCompact = JSON.stringify(med);

      const userPrompt =
        input.modus === "rechnung_pruefung"
          ? rechnungPruefungPrompt(
              parsedCompact,
              analyseCompact,
              `${staticGoae}\n\n${katalogMd}`,
              adminBlock,
              input.extraRules ?? "",
            )
          : leistungenPrompt(
              parsedCompact,
              analyseCompact,
              `${staticGoae}\n\n${katalogMd}`,
              adminBlock,
              input.extraRules ?? "",
            );

      const systemStatic = `Du bist Engine 3 von GOÄ-DocBill. Antworte ausschließlich mit gültigem JSON (ein Objekt).
Punktwert GOÄ: 0,0582873 EUR pro Punkt. Betrag = Punkte × Punktwert × Faktor (auf Cent runden).
Keine personenbezogenen Daten in Freitextfeldern wiederholen. Patient nur als „Patient/in“.
Auslegungsfragen (z. B. BÄK): nur mit konkreter Fundstelle aus dem mitgelieferten **ADMIN-KONTEXT**; ohne solche Quelle keine behauptete amtliche Position.
Alle GOÄ-Ziffern-, Punktwert- und Auslegungsaussagen beziehen sich ausschließlich auf die mitgelieferten Blöcke (GOÄ-Regeltext, Katalogauszug, ADMIN-KONTEXT, Eingabedaten). Keine frei erfundenen Paragraphen oder externen Behauptungen; eine einheitliche **Quellen**-Liste setzt das System nach deiner Antwort. Jede **Position** braucht ein nicht leeres **quelleText** (Bezug zur Eingabe); bei Auslegung aus dem Admin-Kontext **adminQuellen** mit Dateinamen füllen.
${
        input.lastEngine3Result != null
          ? `\nVorheriges Engine-3-Ergebnis (Kontext, ggf. Fortführung):\n${JSON.stringify(input.lastEngine3Result).slice(0, 8000)}`
          : ""
      }`;

      let resultData: Engine3ResultData | null = null;
      const modelsToTry = buildFallbackModels(input.model, { multimodal: false });
      let lastErr = "Modell-Antwort ungültig";
      let lastExtracted: unknown;

      for (const modelTry of modelsToTry) {
        try {
          const raw = await callLlm({
            apiKey,
            model: modelTry,
            systemPrompt: systemStatic,
            userContent: [{ type: "text", text: userPrompt }],
            jsonMode: true,
            temperature: 0.1,
            maxTokens: 8192,
            skipFallbacks: true,
          });
          const obj = extractJson<unknown>(raw);
          lastExtracted = obj;
          resultData = parseEngine3ResultJson(obj, input.modus);
          if (resultData) break;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
        }
      }

      if (!resultData) {
        const sh = (() => {
          if (!lastExtracted || typeof lastExtracted !== "object" || Array.isArray(lastExtracted)) {
            return { top: typeof lastExtracted };
          }
          const r = lastExtracted as Record<string, unknown>;
          const pos = r.positionen ?? r.positions ?? r.Positionen;
          const p0 =
            Array.isArray(pos) && pos[0] && typeof pos[0] === "object" && !Array.isArray(pos[0])
              ? (pos[0] as Record<string, unknown>)
              : null;
          return {
            topKeys: Object.keys(r).slice(0, 28).join(","),
            klinT: typeof r.klinischerKontext,
            fachT: typeof r.fachgebiet,
            hasKeyPositionen: Object.prototype.hasOwnProperty.call(r, "positionen"),
            hasKeyPositions: Object.prototype.hasOwnProperty.call(r, "positions"),
            posT: typeof r.positionen,
            positionsT: typeof (r as { positions?: unknown }).positions,
            posIsArr: Array.isArray(pos),
            posLen: Array.isArray(pos) ? pos.length : null,
            p0nrT: p0 ? typeof p0.nr : null,
            p0ziffT: p0 ? typeof p0.ziffer : null,
            p0fakT: p0 ? typeof p0.faktor : null,
            p0betT: p0 ? typeof p0.betrag : null,
            p0stT: p0 ? typeof p0.status : null,
            p0keys: p0 ? Object.keys(p0).slice(0, 14).join(",") : null,
          };
        })();
        console.error("[Engine3] parseEngine3ResultJson null after retries", JSON.stringify(sh));
        throw new Engine3ParseError(
          `Engine 3 konnte kein gültiges Ergebnis erzeugen (${lastErr}). Bitte erneut versuchen oder anderes Modell wählen.`,
          sh,
        );
      }

      resultData.goaeStandHinweis = resultData.goaeStandHinweis ?? GOAE_STAND_HINWEIS;
      if (adminQuellenHint.length > 0) {
        const merged = new Set([...(resultData.adminQuellen ?? []), ...adminQuellenHint]);
        resultData.adminQuellen = [...merged].slice(0, 12);
      }

      await sendProgress(4, ENGINE3_STEPS[4].label);
      let finalData = applyRecalcAndConsistency(resultData);
      finalData = applyEngine3AusschlussPass(finalData);
      finalData = await critiqueRefineIfNeeded(apiKey, input.model, finalData, katalogMd);
      finalData = applyRecalcAndConsistency(finalData);
      finalData = applyEngine3AusschlussPass(finalData);
      finalData = enforceEngine3Quellenbezug(finalData);

      finalData.goaeStandHinweis = finalData.goaeStandHinweis ?? GOAE_STAND_HINWEIS;
      if (adminQuellenHint.length > 0) {
        const merged = new Set([...(finalData.adminQuellen ?? []), ...adminQuellenHint]);
        finalData.adminQuellen = [...merged].slice(0, 12);
      }
      finalData.quellen = buildEngine3SystemQuellen(input, finalData);

      const clientPayload = toClientEngine3Result(finalData);
      const resultEvent = `data: ${JSON.stringify({
        type: "engine3_result",
        data: clientPayload,
      })}\n\n`;
      await writer.write(encoder.encode(resultEvent));

      const narrativeMd = buildEngine3AssistantMarkdown(finalData);
      const chunkSize = 120;
      for (let i = 0; i < narrativeMd.length; i += chunkSize) {
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: narrativeMd.slice(i, i + chunkSize) } }],
            })}\n\n`,
          ),
        );
      }

      await writer.write(encoder.encode("data: [DONE]\n\n"));
      await writer.close();
    } catch (error) {
      console.error("Engine3 error:", error);
      const msg =
        error instanceof Error
          ? error.message
          : "Engine-3-Pipeline fehlgeschlagen";
      const isKi = /KI-Kontext nicht verfügbar|Embedding/i.test(msg);
      const parseDbg =
        error instanceof Engine3ParseError ? error.parseDebug : undefined;
      await sendError(msg, isKi ? "ENGINE3_KI_CONTEXT" : undefined, parseDbg);
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
