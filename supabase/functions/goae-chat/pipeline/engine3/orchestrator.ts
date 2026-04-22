/**
 * Engine 3 – eigenständige SSE-Pipeline (Rechnungsprüfung + Leistungsabrechnung).
 */

import {
  enrichRagQueryForAuslegung,
  loadKontextAdminUndOrganisation,
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
import {
  buildFallbackEbmCatalogMarkdown,
  buildSelectiveEbmCatalogMarkdown,
  ebmByGop,
} from "../../ebm-catalog-json.ts";
import { parseBehandlungsbericht } from "../dokument-parser.ts";
import { analysiereMedizinisch } from "../medizinisches-nlp.ts";
import { callLlm, extractJson, pickExtractionModel } from "../llm-client.ts";
import { buildFallbackModels } from "../../model-resolver.ts";
import type { FilePayload, ParsedRechnung } from "../types.ts";
import { buildEngine3AssistantMarkdown } from "./markdown-narrative.ts";
import {
  buildAnalyseFromEngine3Like,
  encodeDocbillAnalyseSse,
} from "../../analyse-envelope.ts";
import {
  applyEngine3AusschlussPass,
  applyRecalcAndConsistency,
  enrichEngine3BegruendungBeispiele,
  ensureWarnungFehlerHaveUIFacingRationale,
  enforceEngine3Quellenbezug,
  filterEngine3AdminQuellenToEvidence,
  parseEngine3ResultJson,
  toClientEngine3Result,
  type Engine3Modus,
  type Engine3Regelwerk,
  type Engine3ResultData,
} from "./validate.ts";
import {
  caseUsesMultiDocumentInvoiceReview,
  segmentUploadsForRechnungPruefung,
  validateEngine3CaseGroups,
  type UploadSegmentationCase,
  type UploadSegmentationFileRoles,
} from "./upload-segmentation.ts";
import { Engine3CaseParseError, runRechnungPruefungCasePipeline } from "./run-rechnung-case.ts";

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
  /** Default an: GOÄ-Katalog, Regeltexte und Admin-RAG in LLM-Prompts */
  kontextWissenEnabled?: boolean;
  /** organisations_id für Kommentarliteratur-RAG */
  organisationKontextId?: string | null;
  /** Nach Segmentierungs-Rückfrage: Gruppen von Datei-Indizes (0-basiert), Partition der Uploads. */
  engine3CaseGroups?: number[][];
  mode?: "A" | "B" | "C";
  regelwerk?: "GOAE" | "EBM";
  pseudonymSessionId?: string;
}

async function writeEngine3DocbillAnalyse(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  finalData: Engine3ResultData,
  input: Engine3StreamInput,
): Promise<void> {
  const mode = input.mode ?? (input.modus === "leistungen_abrechnen" ? "B" : "A");
  const regelwerk = input.regelwerk ?? "GOAE";
  const payload = buildAnalyseFromEngine3Like(mode, regelwerk, {
    positionen: finalData.positionen.map((p) => ({
      ziffer: p.ziffer,
      betrag: p.betrag,
      status: String(p.status),
    })),
    optimierungen: finalData.optimierungen?.map((p) => ({ ziffer: p.ziffer, betrag: p.betrag })),
  });
  await writer.write(encoder.encode(encodeDocbillAnalyseSse(payload)));
}

/** Einheitliche, systemseitige Quellenliste für UI und Nachvollziehbarkeit (nicht modell-halluziniert). */
function buildEngine3SystemQuellen(input: Engine3StreamInput, data: Engine3ResultData): string[] {
  if (input.kontextWissenEnabled === false) {
    const lines: string[] = [];
    const nFiles = input.files?.length ?? 0;
    if (nFiles > 0) lines.push(`Eingabe: hochgeladene Datei(en) (${nFiles})`);
    else if (input.modus === "leistungen_abrechnen") {
      lines.push("Eingabe: Freitext der Nutzeranfrage (ohne eingebetteten GOÄ-Prompt-Katalog)");
    }
    for (const a of data.adminQuellen ?? []) {
      const t = String(a).trim();
      if (t) lines.push(`Interner Kontext (RAG): ${t}`);
    }
    return lines.length > 0 ? lines : ["Kein mitgeliefertes Kontextwissen (Nutzer-Einstellung)"];
  }
  const lines: string[] = input.regelwerk === "EBM"
    ? [
      "EBM (GKV): GOP- und Orientierungswert-Referenz (eingebetteter DocBill-Katalogauszug)",
      "Keine GOÄ-Punktwert-0,0582873-Logik in diesem Regelwerk",
    ]
    : [
      "GOÄ-Paragraphen und Bewertungsregeln (eingebetteter DocBill-Referenzblock)",
      "GOÄ-Ziffern und Punktwerte (kontextbezogener Katalogauszug, DocBill JSON)",
    ];
  const nFiles = input.files?.length ?? 0;
  if (nFiles > 0) {
    lines.push(`Eingabe: hochgeladene Datei(en) (${nFiles})`);
  } else if (input.modus === "leistungen_abrechnen") {
    lines.push(
      input.regelwerk === "EBM"
        ? "Eingabe: Freitext der Nutzeranfrage (ohne Dateiupload; EBM-Auszug im Prompt)"
        : "Eingabe: Freitext der Nutzeranfrage (ohne Dateiupload)",
    );
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

function ebmGopSeedFromTexts(texts: string[]): Set<string> {
  const s = new Set<string>();
  const r = /\b(\d{5})\b/g;
  for (const t of texts) {
    if (!t) continue;
    let m: RegExpExecArray | null;
    const rr = new RegExp(r);
    while ((m = rr.exec(t)) !== null) {
      if (m[1] !== "00000" && ebmByGop.has(m[1])) s.add(m[1]);
    }
  }
  return s;
}

function leistungenPrompt(
  parsedJson: string,
  analyseJson: string,
  katalogMd: string,
  adminContext: string,
  extraRules: string,
  regelwerk: Engine3Regelwerk = "GOAE",
): string {
  if (regelwerk === "EBM") {
    return `Du bist EBM-DocBill Engine 3. Modus: **Leistungen abrechnen** (GKV, **GOP** fünf Stellen, Aus Text/Akte Vorschläge).

Erstelle eine regelkonforme **EBM**-Positionsliste. Nutze nur **GOPs** aus dem Katalogauszug. **faktor** in der Regel 1,0. **betrag** = Euro laut Katalog (nicht GOÄ 0,0582873).
Ordne jeder Position ein **quelleText** (Zitat/Paraphrase) zu. Unsichere Zuordnungen: status "warnung".

**Pflicht-Checkliste**
- Nur GOPs aus dem Auszug; keine erfundenen Nummern.
- **Ausschlüsse:** Katalogausschnitt beachten; Konflikte in **hinweise** und ggf. status warnung/fehler.
- **Hinweis-Zuordnung:** **betrifftPositionen** mit **nr** der betroffenen Zeilen, wo sinnvoll.
- **Warnung/Fehler:** Wie in GOÄ-Modus: ausreichend erklärender Text (Hinweis/Anmerkung).

**System-Nachbearbeitung:** DocBill wendet EBM-Rechen- und Ausschlussregeln deterministisch an; Ergebnis ist maßgeblich.

Antworte NUR mit JSON (Schema wie GOÄ-Modus, aber **faktor** typischerweise 1,0; **ziffer** = 5-stellige GOP):
{
  "klinischerKontext": "2–4 Sätze",
  "fachgebiet": "string",
  "positionen": [ { "nr": 1, "ziffer": "01100", "bezeichnung": "…", "faktor": 1.0, "betrag": 0.0, "status": "korrekt|warnung|vorschlag", "anmerkung": "optional", "quelleText": "…", "begruendung": "optional" } ],
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

## EBM-KATALOG (Auszug)
${katalogMd}
`;
  }
  return `Du bist GOÄ-DocBill Engine 3. Modus: **Leistungen abrechnen** (Aus Text/Akte Vorschläge).

Erstelle eine regelkonforme GOÄ-Liste zur Abrechnung der dokumentierten Leistungen.
Nutze nur Ziffern aus dem Katalogauszug. Ordne jeder Position ein kurzes quelleText (Zitat/Paraphrase aus dem Dokument) zu.
Markiere unsichere Zuordnungen mit status "warnung" und erkläre in anmerkung.

**Pflicht-Checkliste**
- Nur Ziffern aus dem Katalogauszug; keine halluzinierten Nummern.
- **Ausschlüsse:** alle vorgeschlagenen Ziffern paarweise gegen die Ausschl-Angaben im Auszug prüfen; Konflikte → **hinweise** + ggf. Position „warnung“/„fehler“.
- **Steigerung:** Faktor innerhalb Katalograhmen; über Schwellenwert → ausführliche **begruendung** (§ 5 Abs. 2 GOÄ), konkret und prüfernah. Optional **begruendungBeispiele** (Array mit bis zu drei vollständigen, direkt übernehmbaren Absätzen) nur wenn sinnvoll; DocBill ergänzt ggf. kanonische Vorlagen (drei Varianten).
- **Sonderfälle** ( Leichenschau, Not-/Zeitzuschläge, Akupunktur): nur mit Ziffer im Auszug; sonst **hinweis** auf unvollständigen Kontext.
- **BÄK / GOÄ-Kommentar:** Nur wenn **ADMIN-KONTEXT** eine belegbare Fundstelle liefert; jede verwendete Admin-Datei in **adminQuellen** nennen. Behauptete Regeln in **hinweise** mit **regelReferenz** belegen („GOÄ-Katalogauszug …“ oder „ADMIN-KONTEXT: …“).
- **Hinweis-Zuordnung:** **betrifftPositionen**: **nr**-Werte der betroffenen Zeilen aus **positionen**/**optimierungen**; bei allgemeinen Hinweisen weglassen.
- **Warnung/Fehler bei Positionen:** Hat eine Zeile **status** „warnung“ oder „fehler“, MUSS mindestens **120 Zeichen** erklärender Klartext folgen — entweder in **anmerkung** und/oder **begruendung** ODER in **hinweise** mit **betrifftPositionen** enthält diese **nr** und **detail** mindestens **80 Zeichen**. Formulierungen sollen **direkt in die Akten-/Abrechnungsnotiz übernehmbar** sein (keine leeren Floskeln, keine Platzhalter wie „[…]“).

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
      "begruendung": "optional",
      "begruendungBeispiele": ["optional: bis zu 3 fertige Absätze"]
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
Erhalte **betrifftPositionen** an **hinweise**, wo sinnvoll (Array der **nr** der betroffenen Zeilen).
**Warnung/Fehler:** Für jede Position mit status **warnung** oder **fehler** verlangt die Ausgabe mindestens **120 Zeichen** Begründung gesamt (Summe aus **anmerkung**, **begruendung** und zugehörigen **hinweise**-**detail** mit passender **betrifftPositionen**). Liefere **konkrete, copy-paste-fähige** Sätze für die Patientendokumentation; fehlt das, ergänze **anmerkung** und/oder einen passenden **hinweis** mit **betrifftPositionen**.`;

async function critiqueRefineIfNeeded(
  apiKey: string,
  userModel: string,
  data: Engine3ResultData,
  katalogMd: string,
  regelwerk: Engine3Regelwerk = "GOAE",
): Promise<Engine3ResultData> {
  const model = pickExtractionModel(userModel);
  const body = JSON.stringify(data);
  if (body.length > 48_000) return data;
  if (!katalogMd.trim()) return data;

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
    const next = parseEngine3ResultJson(parsed, data.modus, regelwerk);
    if (!next) return data;
    const adminMerged = [
      ...new Set([...(next.adminQuellen ?? []), ...(data.adminQuellen ?? [])]),
    ].slice(0, 12);
    return applyRecalcAndConsistency(
      {
        ...next,
        goaeStandHinweis: next.goaeStandHinweis ?? data.goaeStandHinweis,
        ...(adminMerged.length ? { adminQuellen: adminMerged } : {}),
      },
      regelwerk,
    );
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
    const sendProgress = async (
      step: number,
      label: string,
      caseMeta?: { caseIndex: number; totalCases: number },
    ) => {
      const payload: Record<string, unknown> = {
        type: "engine3_progress",
        step: step + 1,
        totalSteps: ENGINE3_STEPS.length,
        label:
          caseMeta && caseMeta.totalCases > 1
            ? `${label} (Vorgang ${caseMeta.caseIndex} von ${caseMeta.totalCases})`
            : label,
      };
      if (caseMeta && caseMeta.totalCases > 1) {
        payload.caseIndex = caseMeta.caseIndex;
        payload.totalCases = caseMeta.totalCases;
      }
      await writer.write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
    };

    const streamMarkdown = async (md: string) => {
      const chunkSize = 120;
      for (let i = 0; i < md.length; i += chunkSize) {
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: md.slice(i, i + chunkSize) } }],
            })}\n\n`,
          ),
        );
      }
    };

    try {
      const kontextOk = input.kontextWissenEnabled !== false;
      await sendProgress(0, ENGINE3_STEPS[0].label);
      if (kontextOk) await preflightEngine3KiContext(apiKey);

      if (input.modus === "rechnung_pruefung") {
        if (!input.files?.length) {
          throw new Error("Für die Rechnungsprüfung wird eine Datei benötigt.");
        }
        const allFiles = input.files;

        const multiReviewFor = (indices: number[], rolesFromSeg: UploadSegmentationFileRoles | null) => {
          if (indices.length < 2) return false;
          if (rolesFromSeg) return caseUsesMultiDocumentInvoiceReview(indices, rolesFromSeg);
          return indices.length >= 2;
        };

        const pickCaseFiles = (indices: number[]) => indices.map((i) => allFiles[i]);

        if (allFiles.length === 1) {
          await sendProgress(1, ENGINE3_STEPS[1].label);
          await sendProgress(2, ENGINE3_STEPS[2].label);
          await sendProgress(3, ENGINE3_STEPS[3].label);
          const finalData = await runRechnungPruefungCasePipeline({
            filesCase: allFiles,
            multiDocumentInvoiceReview: false,
            userMessage: input.userMessage,
            model: input.model,
            extraRules: input.extraRules ?? "",
            lastResult: input.lastResult,
            lastEngine3Result: input.lastEngine3Result,
            kontextWissenEnabled: kontextOk,
            organisationKontextId: input.organisationKontextId,
            apiKey,
            quellenFileCount: 1,
            pseudonymSessionId: input.pseudonymSessionId,
            regelwerk: input.regelwerk === "EBM" ? "EBM" : "GOAE",
          });
          await sendProgress(4, ENGINE3_STEPS[4].label);
          const clientPayload = toClientEngine3Result(finalData);
          await writer.write(
            encoder.encode(`data: ${JSON.stringify({ type: "engine3_result", data: clientPayload })}\n\n`),
          );
          await writeEngine3DocbillAnalyse(writer, encoder, finalData, input);
          await streamMarkdown(buildEngine3AssistantMarkdown(finalData));
          await writer.write(encoder.encode("data: [DONE]\n\n"));
          await writer.close();
          return;
        }

        const validatedGroups = validateEngine3CaseGroups(allFiles.length, input.engine3CaseGroups);
        let casesForRun: UploadSegmentationCase[];
        let rolesFromSeg: UploadSegmentationFileRoles | null = null;

        if (validatedGroups) {
          casesForRun = validatedGroups.map((fileIndices, i) => ({
            id: `u-${i}`,
            fileIndices,
          }));
        } else {
          await sendProgress(1, ENGINE3_STEPS[1].label);
          const seg = await segmentUploadsForRechnungPruefung(allFiles, apiKey, input.model);
          rolesFromSeg = seg.fileRoles;
          if (seg.needsUserConfirmation) {
            const proposal = {
              fileRoles: seg.fileRoles,
              cases: seg.cases.map((c) => ({
                id: c.id,
                fileIndices: c.fileIndices,
                title: c.title,
              })),
              confidence: seg.confidence,
              fileNames: allFiles.map((f) => f.name),
            };
            await writer.write(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "engine3_segmentation_pending",
                  data: proposal,
                })}\n\n`,
              ),
            );
            const hint =
              "## Zuordnung der Dateien\n\nDie automatische Zuordnung ist unsicher. " +
              "Bitte **Vorgänge** im nächsten Schritt festlegen (welche Dateien gehören zu einer Rechnung) " +
              "und die Analyse mit derselben Dateiauswahl erneut starten.";
            await streamMarkdown(hint);
            await writer.write(encoder.encode("data: [DONE]\n\n"));
            await writer.close();
            return;
          }
          casesForRun = seg.cases;
        }

        if (casesForRun.length === 1) {
          const c0 = casesForRun[0];
          const filesCase = pickCaseFiles(c0.fileIndices);
          await sendProgress(1, ENGINE3_STEPS[1].label);
          await sendProgress(2, ENGINE3_STEPS[2].label);
          await sendProgress(3, ENGINE3_STEPS[3].label);
          const finalData = await runRechnungPruefungCasePipeline({
            filesCase,
            multiDocumentInvoiceReview: multiReviewFor(c0.fileIndices, rolesFromSeg),
            userMessage: input.userMessage,
            model: input.model,
            extraRules: input.extraRules ?? "",
            lastResult: input.lastResult,
            lastEngine3Result: input.lastEngine3Result,
            kontextWissenEnabled: kontextOk,
            organisationKontextId: input.organisationKontextId,
            apiKey,
            quellenFileCount: filesCase.length,
            pseudonymSessionId: input.pseudonymSessionId,
            regelwerk: input.regelwerk === "EBM" ? "EBM" : "GOAE",
          });
          await sendProgress(4, ENGINE3_STEPS[4].label);
          const clientPayload = toClientEngine3Result(finalData);
          await writer.write(
            encoder.encode(`data: ${JSON.stringify({ type: "engine3_result", data: clientPayload })}\n\n`),
          );
          await writeEngine3DocbillAnalyse(writer, encoder, finalData, input);
          await streamMarkdown(buildEngine3AssistantMarkdown(finalData));
          await writer.write(encoder.encode("data: [DONE]\n\n"));
          await writer.close();
          return;
        }

        const totalCases = casesForRun.length;
        const batchCases: {
          caseId: string;
          caseIndex: number;
          totalCases: number;
          title: string;
          filenames: string[];
          data: ReturnType<typeof toClientEngine3Result>;
        }[] = [];
        const narrativeParts: string[] = [];
        let firstBatchEngine3Data: Engine3ResultData | undefined;

        for (let i = 0; i < totalCases; i++) {
          const c = casesForRun[i];
          const filesCase = pickCaseFiles(c.fileIndices);
          const caseMeta = { caseIndex: i + 1, totalCases };
          await sendProgress(1, ENGINE3_STEPS[1].label, caseMeta);
          await sendProgress(2, ENGINE3_STEPS[2].label, caseMeta);
          await sendProgress(3, ENGINE3_STEPS[3].label, caseMeta);

          const finalData = await runRechnungPruefungCasePipeline({
            filesCase,
            multiDocumentInvoiceReview: multiReviewFor(c.fileIndices, rolesFromSeg),
            userMessage: input.userMessage,
            model: input.model,
            extraRules: input.extraRules ?? "",
            lastResult: input.lastResult,
            lastEngine3Result: i === 0 ? input.lastEngine3Result : undefined,
            kontextWissenEnabled: kontextOk,
            organisationKontextId: input.organisationKontextId,
            apiKey,
            quellenFileCount: filesCase.length,
            pseudonymSessionId: input.pseudonymSessionId,
            regelwerk: input.regelwerk === "EBM" ? "EBM" : "GOAE",
          });

          await sendProgress(4, ENGINE3_STEPS[4].label, caseMeta);
          const clientPayload = toClientEngine3Result(finalData);
          const title =
            c.title?.trim() || (filesCase.length === 1 ? filesCase[0].name : `Vorgang ${i + 1}`);
          batchCases.push({
            caseId: c.id,
            caseIndex: i + 1,
            totalCases,
            title,
            filenames: filesCase.map((f) => f.name),
            data: clientPayload,
          });
          if (i === 0) firstBatchEngine3Data = finalData;
          await writer.write(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "engine3_case_result",
                caseId: c.id,
                caseIndex: i + 1,
                totalCases,
                title,
                filenames: filesCase.map((f) => f.name),
                data: clientPayload,
              })}\n\n`,
            ),
          );
          narrativeParts.push(
            `${i > 0 ? "\n\n---\n\n" : ""}## ${title}\n\n${buildEngine3AssistantMarkdown(finalData)}`,
          );
        }

        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "engine3_batch_complete",
              totalCases,
              cases: batchCases.map((b) => ({
                caseId: b.caseId,
                caseIndex: b.caseIndex,
                title: b.title,
                filenames: b.filenames,
                data: b.data,
              })),
            })}\n\n`,
          ),
        );
        if (firstBatchEngine3Data) {
          await writeEngine3DocbillAnalyse(writer, encoder, firstBatchEngine3Data, input);
        }
        await streamMarkdown(narrativeParts.join(""));
        await writer.write(encoder.encode("data: [DONE]\n\n"));
        await writer.close();
        return;
      }

      await sendProgress(1, ENGINE3_STEPS[1].label);
      let parsed: ParsedRechnung;
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

      const med = await analysiereMedizinisch(parsed, apiKey, input.model, undefined, kontextOk, {
        pseudonymSessionId: input.pseudonymSessionId,
      });

      await sendProgress(2, ENGINE3_STEPS[2].label);
      const mergeQuery = enrichRagQueryForAuslegung(
        buildPipelineQuery(
          input.userMessage,
          { medizinischeAnalyse: med, pruefung: undefined },
          input.lastResult,
        ),
      );
      const adminBlock = kontextOk
        ? await loadKontextAdminUndOrganisation(mergeQuery, apiKey, {
            vectorQuery: enrichRagQueryForAuslegung(input.userMessage.trim() || mergeQuery),
            organisationKontextId: input.organisationKontextId ?? null,
          })
        : "";
      const rwE3: Engine3Regelwerk = input.regelwerk === "EBM" ? "EBM" : "GOAE";
      const leistungTexts = leistungstexteFromParsed(parsed, input.userMessage);
      const katalogMdGoae = kontextOk
        ? buildMappingCatalogMarkdown({
            leistungTexts,
            fachgebiet: med.fachgebiet,
            maxLines: 200,
          })
        : "";
      const katalogMdEbm = kontextOk
        ? (() => {
            const gops = ebmGopSeedFromTexts([
              ...leistungTexts,
              med.fachgebiet,
              med.klinischerKontext || "",
            ]);
            if (gops.size === 0) return buildFallbackEbmCatalogMarkdown(120);
            return buildSelectiveEbmCatalogMarkdown({
              gops,
              maxLines: 200,
              subtitle: "## EBM-Katalog (Auszug)",
              priorityGops: gops,
            });
          })()
        : "";

      const staticGoae = kontextOk
        ? [
            GOAE_PARAGRAPHEN_KOMPAKT,
            GOAE_ABSCHNITTE_KOMPAKT,
            GOAE_SONDERBEREICHE_KOMPAKT,
            GOAE_ANALOGE_BEWERTUNG,
            GOAE_BEGRUENDUNGEN,
          ].join("\n\n")
        : "";

      const katalogBundle = kontextOk
        ? (rwE3 === "EBM"
          ? `EBM (GKV): **GOP** fünf Stellen; Betrag in Euro gemäß Katalog (Punkte und Orientierungswert). Kein GOÄ-Punktwert 0,0582873.\n\n${katalogMdEbm}`
          : `${staticGoae}\n\n${katalogMdGoae}`)
        : "(Hinweis für das Modell: Der Nutzer hat **Kontextwissen** ausgeschaltet. Es gibt keinen eingebetteten GOÄ-Regelblock, keinen Katalogauszug und keinen ADMIN-KONTEXT. Nutze ausschließlich die Eingabe-JSONs; erfinde keine Ziffern oder Beträge; Unsicherheit in **hinweise**.)";

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

      const userPrompt = leistungenPrompt(
        parsedCompact,
        analyseCompact,
        katalogBundle,
        adminBlock,
        input.extraRules ?? "",
        rwE3,
      );

      const systemStatic = kontextOk
        ? (rwE3 === "EBM"
          ? `Du bist Engine 3 von EBM-DocBill (GKV). Antworte ausschließlich mit gültigem JSON (ein Objekt).
**ziffer** = 5-stellige GOP. **faktor** meist 1,0. **betrag** = Euro laut EBM-Auszug (nicht GOÄ 0,0582873).
Keine personenbezogenen Daten; Patient nur als „Patient/in“.
Auslegung nur mit Fundstelle im **ADMIN-KONTEXT**.
Jede **Position** braucht **quelleText**.
${
            input.lastEngine3Result != null
              ? `\nVorheriges Engine-3-Ergebnis (Kontext, ggf. Fortführung):\n${JSON.stringify(input.lastEngine3Result).slice(0, 8000)}`
              : ""
          }`
          : `Du bist Engine 3 von GOÄ-DocBill. Antworte ausschließlich mit gültigem JSON (ein Objekt).
Punktwert GOÄ: 0,0582873 EUR pro Punkt. Betrag = Punkte × Punktwert × Faktor (auf Cent runden).
Keine personenbezogenen Daten in Freitextfeldern wiederholen. Patient nur als „Patient/in“.
Auslegungsfragen (z. B. BÄK): nur mit konkreter Fundstelle aus dem mitgelieferten **ADMIN-KONTEXT**; ohne solche Quelle keine behauptete amtliche Position.
Alle GOÄ-Ziffern-, Punktwert- und Auslegungsaussagen beziehen sich ausschließlich auf die mitgelieferten Blöcke (GOÄ-Regeltext, Katalogauszug, ADMIN-KONTEXT, Eingabedaten). Keine frei erfundenen Paragraphen oder externen Behauptungen; eine einheitliche **Quellen**-Liste setzt das System nach deiner Antwort. Jede **Position** braucht ein nicht leeres **quelleText** (Bezug zur Eingabe); bei Auslegung aus dem Admin-Kontext **adminQuellen** mit Dateinamen füllen.
${
            input.lastEngine3Result != null
              ? `\nVorheriges Engine-3-Ergebnis (Kontext, ggf. Fortführung):\n${JSON.stringify(input.lastEngine3Result).slice(0, 8000)}`
              : ""
          }`)
        : (rwE3 === "EBM"
          ? `Du bist Engine 3 von EBM-DocBill. JSON-only. Kein Katalog in dieser Anfrage (Kontext aus). Erfinde keine GOPs. **quelleText** pro Position.
${
            input.lastEngine3Result != null
              ? `\nVorheriges Engine-3-Ergebnis (Kontext, ggf. Fortführung):\n${JSON.stringify(input.lastEngine3Result).slice(0, 8000)}`
              : ""
          }`
          : `Du bist Engine 3 von GOÄ-DocBill. Antworte ausschließlich mit gültigem JSON (ein Objekt).
Punktwert GOÄ: 0,0582873 EUR pro Punkt. Betrag = Punkte × Punktwert × Faktor (auf Cent runden).
Keine personenbezogenen Daten in Freitextfeldern wiederholen. Patient nur als „Patient/in“.
**Kein** eingebetteter GOÄ-Katalog, Regelblock oder ADMIN-KONTEXT in dieser Anfrage (Nutzer hat Kontextwissen ausgeschaltet). Nutze ausschließlich die **Eingabe-JSONs** im Nutzerprompt. Erfinde keine Ziffern; Unsicherheit und Lücken klar in **hinweise**; **warnung**/**fehler** wo angebracht. Jede **Position** ein nicht leeres **quelleText** mit Bezug zur Eingabe. Keine behaupteten Auslegungen oder Kommentar-Zitate ohne Beleg.
${
            input.lastEngine3Result != null
              ? `\nVorheriges Engine-3-Ergebnis (Kontext, ggf. Fortführung):\n${JSON.stringify(input.lastEngine3Result).slice(0, 8000)}`
              : ""
          }`);

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
          resultData = parseEngine3ResultJson(obj, input.modus, rwE3);
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

      resultData.goaeStandHinweis = resultData.goaeStandHinweis ??
        (rwE3 === "EBM"
          ? "EBM: GOP und Euro nach DocBill-Katalog (JSON); Orientierungswert siehe Kopfzeile Katalog."
          : GOAE_STAND_HINWEIS);

      const katalogMdCritique = rwE3 === "EBM" ? katalogMdEbm : katalogMdGoae;

      await sendProgress(4, ENGINE3_STEPS[4].label);
      let finalData = applyRecalcAndConsistency(resultData, rwE3);
      finalData = applyEngine3AusschlussPass(finalData, rwE3);
      finalData = await critiqueRefineIfNeeded(
        apiKey,
        input.model,
        finalData,
        katalogMdCritique,
        rwE3,
      );
      finalData = applyRecalcAndConsistency(finalData, rwE3);
      finalData = applyEngine3AusschlussPass(finalData, rwE3);
      finalData = enforceEngine3Quellenbezug(finalData);
      finalData = ensureWarnungFehlerHaveUIFacingRationale(finalData);
      finalData = enrichEngine3BegruendungBeispiele(finalData);

      finalData.goaeStandHinweis = finalData.goaeStandHinweis ??
        (rwE3 === "EBM"
          ? "EBM: GOP und Euro nach DocBill-Katalog (JSON); Orientierungswert siehe Kopfzeile Katalog."
          : GOAE_STAND_HINWEIS);
      finalData = filterEngine3AdminQuellenToEvidence(finalData);
      finalData.quellen = buildEngine3SystemQuellen(input, finalData);

      const clientPayload = toClientEngine3Result(finalData);
      const resultEvent = `data: ${JSON.stringify({
        type: "engine3_result",
        data: clientPayload,
      })}\n\n`;
      await writer.write(encoder.encode(resultEvent));

      await writeEngine3DocbillAnalyse(writer, encoder, finalData, input);

      const narrativeMd = buildEngine3AssistantMarkdown(finalData);
      await streamMarkdown(narrativeMd);

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
        error instanceof Engine3ParseError
          ? error.parseDebug
          : error instanceof Engine3CaseParseError
            ? error.parseDebug
            : undefined;
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
