/**
 * Eine Rechnungsprüfung (ein Case / eine Gruppe von Dateien) durch Engine 3.
 */

import {
  enrichRagQueryForAuslegung,
  loadKontextAdminUndOrganisation,
  buildPipelineQuery,
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
import { parseDokumentWithRetry } from "../dokument-parser.ts";
import { analysiereMedizinisch } from "../medizinisches-nlp.ts";
import { callLlm, extractJson, pickExtractionModel } from "../llm-client.ts";
import { buildFallbackModels } from "../../model-resolver.ts";
import type { FilePayload, ParsedRechnung } from "../types.ts";
import {
  applyEngine3AusschlussPass,
  applyRecalcAndConsistency,
  enrichEngine3BegruendungBeispiele,
  ensureWarnungFehlerHaveUIFacingRationale,
  enforceEngine3Quellenbezug,
  filterEngine3AdminQuellenToEvidence,
  parseEngine3ResultJson,
  type Engine3Modus,
  type Engine3Regelwerk,
  type Engine3ResultData,
} from "./validate.ts";

const GOAE_STAND_HINWEIS =
  "GOÄ-Ziffern und Punktwerte nach DocBill-Katalog (JSON); Punktwert 0,0582873 EUR.";

const EBM_STAND_HINWEIS =
  "EBM: GOPs und Euro nach DocBill-Katalog (JSON); Orientierungswert siehe Katalogkopf.";

function ebmGopSeedFromTextsCase(texts: string[]): Set<string> {
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
- **Steigerung:** Schwellen-/Höchstfaktor aus Katalogzeile; über Schwelle → **begruendung** mit konkretem Sachbezug (Dauer Min., Erschwernis), § 5 Abs. 2 GOÄ; keine Leerformeln (siehe Regelblock Begründungen). Optional **begruendungBeispiele** (bis zu drei vollständige Absätze) nur wenn sinnvoll; DocBill ergänzt ggf. kanonische Vorlagen (drei Varianten).
- **Sonderbereiche** (Leichenschau, Zuschläge, Akupunktur): nur, wenn die Ziffer im Auszug steht; sonst Lücke in **hinweise**.
- **BÄK / Auslegung / GOÄ-Kommentar:** Nur mit konkretem Nachweis im **ADMIN-KONTEXT** (Dateiname); jede inhaltlich verwendete Admin-Datei **mindestens einmal** in **adminQuellen** (kurzer Dateiname) aufführen. Ohne Treffer: Unsicherheit in **hinweise**, nichts erfinden.
- **Hinweise:** Behauptet ein Eintrag eine konkrete Regel oder Auslegung, **muss** **regelReferenz** gesetzt sein (z. B. „GOÄ-Katalogauszug, Ziffer …“ oder „ADMIN-KONTEXT: [Dateiname]“).
- **Hinweis-Zuordnung:** Betrifft ein Hinweis konkrete Tabellenzeilen, setze **betrifftPositionen** als Array der zugehörigen **nr**-Werte aus **positionen** oder **optimierungen**; bei rein allgemeinen Hinweisen weglassen oder leeres Array.
- **Warnung/Fehler bei Positionen:** Hat eine Zeile **status** „warnung“ oder „fehler“, MUSS mindestens **120 Zeichen** erklärender Klartext folgen — entweder in **anmerkung** und/oder **begruendung** ODER in **hinweise** mit **betrifftPositionen** enthält diese **nr** und **detail** mindestens **80 Zeichen**. Formulierungen sollen **direkt in die Akten-/Abrechnungsnotiz übernehmbar** sein (keine leeren Floskeln, keine Platzhalter wie „[…]“).

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
      "begruendung": "optional bei hohem Faktor",
      "begruendungBeispiele": ["optional: bis zu 3 fertige Absätze"]
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

function rechnungPruefungPromptEbm(
  parsedJson: string,
  analyseJson: string,
  katalogMd: string,
  adminContext: string,
  extraRules: string,
): string {
  return `Du bist EBM-DocBill Engine 3. Modus: **Rechnungsprüfung** (GKV, **GOP**).

Du erhältst Rechnungsdaten (JSON) und medizinische Analyse. Nutze nur **GOPs** und Euro aus dem EBM-Auszug. **faktor** meist 1,0. Kein GOÄ-Punktwert 0,0582873.
**Ausschlüsse** laut Katalog; Konflikte in **hinweise** und status.
**quelleText** pro Position (Pflicht).

Antworte NUR mit JSON (gleiche Struktur wie GOÄ-Modus; **ziffer** = 5-stellige GOP, **faktor** = 1.0):
{
  "klinischerKontext": "2–4 Sätze",
  "fachgebiet": "string",
  "positionen": [ { "nr": 1, "ziffer": "01100", "bezeichnung": "…", "faktor": 1.0, "betrag": 0.0, "status": "korrekt|warnung|fehler", "anmerkung": "optional", "quelleText": "…", "begruendung": "optional" } ],
  "hinweise": [ { "schwere": "fehler|warnung|info", "titel": "kurz", "detail": "…", "regelReferenz": "optional", "betrifftPositionen": [1] } ],
  "optimierungen": [],
  "adminQuellen": []
}

Eingabe Rechnung (JSON):
${parsedJson}

Eingabe medizinische Analyse (JSON):
${analyseJson}

${extraRules ? `## ZUSÄTZLICHE REGELN:\n${extraRules}\n` : ""}

${adminContext ? `${adminContext}\n` : ""}

## EBM-KATALOG (Auszug)
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

export type RunRechnungCaseParams = {
  filesCase: FilePayload[];
  multiDocumentInvoiceReview: boolean;
  userMessage: string;
  model: string;
  extraRules: string;
  lastResult?: LastResultContext;
  lastEngine3Result?: unknown;
  kontextWissenEnabled: boolean;
  organisationKontextId?: string | null;
  apiKey: string;
  /** Quellen-Zeile „Eingabe: …“ pro Case */
  quellenFileCount: number;
  pseudonymSessionId?: string;
  regelwerk?: Engine3Regelwerk;
};

export class Engine3CaseParseError extends Error {
  readonly parseDebug: Record<string, unknown>;
  constructor(message: string, parseDebug: Record<string, unknown>) {
    super(message);
    this.name = "Engine3CaseParseError";
    this.parseDebug = parseDebug;
  }
}

export async function runRechnungPruefungCasePipeline(p: RunRechnungCaseParams): Promise<Engine3ResultData> {
  const rw: Engine3Regelwerk = p.regelwerk ?? "GOAE";
  const parsed = await parseDokumentWithRetry(p.filesCase, p.apiKey, p.model, {
    multiDocumentInvoiceReview: p.multiDocumentInvoiceReview,
    regelwerk: rw === "EBM" ? "EBM" : "GOAE",
  });

  const med = await analysiereMedizinisch(parsed, p.apiKey, p.model, undefined, p.kontextWissenEnabled, {
    pseudonymSessionId: p.pseudonymSessionId,
  });

  const mergeQuery = enrichRagQueryForAuslegung(
    buildPipelineQuery(
      p.userMessage,
      { medizinischeAnalyse: med, pruefung: undefined },
      p.lastResult,
    ),
  );
  const adminBlock = p.kontextWissenEnabled
    ? await loadKontextAdminUndOrganisation(mergeQuery, p.apiKey, {
        vectorQuery: enrichRagQueryForAuslegung(p.userMessage.trim() || mergeQuery),
        organisationKontextId: p.organisationKontextId ?? null,
      })
    : "";
  const leistungTexts = leistungstexteFromParsed(parsed, p.userMessage);
  const katalogMdGoae = p.kontextWissenEnabled
    ? buildMappingCatalogMarkdown({
        leistungTexts,
        fachgebiet: med.fachgebiet,
        maxLines: 200,
      })
    : "";
  const katalogMdEbm = p.kontextWissenEnabled
    ? (() => {
        const gops = ebmGopSeedFromTextsCase([
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
  const katalogMd = rw === "EBM" ? katalogMdEbm : katalogMdGoae;

  const staticGoae = p.kontextWissenEnabled
    ? [
        GOAE_PARAGRAPHEN_KOMPAKT,
        GOAE_ABSCHNITTE_KOMPAKT,
        GOAE_SONDERBEREICHE_KOMPAKT,
        GOAE_ANALOGE_BEWERTUNG,
        GOAE_BEGRUENDUNGEN,
      ].join("\n\n")
    : "";

  const katalogBundle = p.kontextWissenEnabled
    ? (rw === "EBM"
      ? `EBM (GKV): GOP fünf Stellen; Euro laut Katalog. Kein GOÄ 0,0582873.\n\n${katalogMdEbm}`
      : `${staticGoae}\n\n${katalogMdGoae}`)
    : "(Hinweis für das Modell: Der Nutzer hat **Kontextwissen** ausgeschaltet. Es gibt keinen eingebetteten GOÄ-Regelblock, keinen Katalogauszug und keinen ADMIN-KONTEXT. Nutze ausschließlich die Eingabe-JSONs; erfinde keine Ziffern oder Beträge; Unsicherheit in **hinweise**.)";

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

  const userPrompt = rw === "EBM"
    ? rechnungPruefungPromptEbm(
      parsedCompact,
      analyseCompact,
      katalogBundle,
      adminBlock,
      p.extraRules ?? "",
    )
    : rechnungPruefungPrompt(
      parsedCompact,
      analyseCompact,
      katalogBundle,
      adminBlock,
      p.extraRules ?? "",
    );

  const modus: Engine3Modus = "rechnung_pruefung";
  const systemStatic = p.kontextWissenEnabled
    ? (rw === "EBM"
      ? `Du bist Engine 3 von EBM-DocBill (GKV). Antworte ausschließlich mit gültigem JSON (ein Objekt).
GOP fünf Stellen; **betrag** in Euro laut EBM-Auszug; **faktor** meist 1,0. Kein GOÄ-Punktwert.
Keine personenbezogenen Daten; Patient nur als „Patient/in“.
Jede **Position** braucht **quelleText**.
${p.lastEngine3Result != null ? `\nVorheriges Engine-3-Ergebnis (Kontext, ggf. Fortführung):\n${JSON.stringify(p.lastEngine3Result).slice(0, 8000)}` : ""}`
      : `Du bist Engine 3 von GOÄ-DocBill. Antworte ausschließlich mit gültigem JSON (ein Objekt).
Punktwert GOÄ: 0,0582873 EUR pro Punkt. Betrag = Punkte × Punktwert × Faktor (auf Cent runden).
Keine personenbezogenen Daten in Freitextfeldern wiederholen. Patient nur als „Patient/in“.
Auslegungsfragen (z. B. BÄK): nur mit konkreter Fundstelle aus dem mitgelieferten **ADMIN-KONTEXT**; ohne solche Quelle keine behauptete amtliche Position.
Alle GOÄ-Ziffern-, Punktwert- und Auslegungsaussagen beziehen sich ausschließlich auf die mitgelieferten Blöcke (GOÄ-Regeltext, Katalogauszug, ADMIN-KONTEXT, Eingabedaten). Keine frei erfundenen Paragraphen oder externen Behauptungen; eine einheitliche **Quellen**-Liste setzt das System nach deiner Antwort. Jede **Position** braucht ein nicht leeres **quelleText** (Bezug zur Eingabe); bei Auslegung aus dem Admin-Kontext **adminQuellen** mit Dateinamen füllen.
${p.lastEngine3Result != null ? `\nVorheriges Engine-3-Ergebnis (Kontext, ggf. Fortführung):\n${JSON.stringify(p.lastEngine3Result).slice(0, 8000)}` : ""}`)
    : (rw === "EBM"
      ? `Du bist Engine 3 von EBM-DocBill. JSON-only. Kein Katalog in dieser Anfrage. Erfinde keine GOPs. **quelleText** pro Position.
${p.lastEngine3Result != null ? `\nVorheriges Engine-3-Ergebnis (Kontext, ggf. Fortführung):\n${JSON.stringify(p.lastEngine3Result).slice(0, 8000)}` : ""}`
      : `Du bist Engine 3 von GOÄ-DocBill. Antworte ausschließlich mit gültigem JSON (ein Objekt).
Punktwert GOÄ: 0,0582873 EUR pro Punkt. Betrag = Punkte × Punktwert × Faktor (auf Cent runden).
Keine personenbezogenen Daten in Freitextfeldern wiederholen. Patient nur als „Patient/in“.
**Kein** eingebetteter GOÄ-Katalog, Regelblock oder ADMIN-KONTEXT in dieser Anfrage (Nutzer hat Kontextwissen ausgeschaltet). Nutze ausschließlich die **Eingabe-JSONs** im Nutzerprompt. Erfinde keine Ziffern; Unsicherheit und Lücken klar in **hinweise**; **warnung**/**fehler** wo angebracht. Jede **Position** ein nicht leeres **quelleText** mit Bezug zur Eingabe. Keine behaupteten Auslegungen oder Kommentar-Zitate ohne Beleg.
${p.lastEngine3Result != null ? `\nVorheriges Engine-3-Ergebnis (Kontext, ggf. Fortführung):\n${JSON.stringify(p.lastEngine3Result).slice(0, 8000)}` : ""}`);

  let resultData: Engine3ResultData | null = null;
  const modelsToTry = buildFallbackModels(p.model, { multimodal: false });
  let lastErr = "Modell-Antwort ungültig";
  let lastExtracted: unknown;

  for (const modelTry of modelsToTry) {
    try {
      const raw = await callLlm({
        apiKey: p.apiKey,
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
      resultData = parseEngine3ResultJson(obj, modus, rw);
      if (resultData) break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }

  if (!resultData) {
    const sh = { lastErr, lastExtractedType: typeof lastExtracted };
    console.error("[Engine3 case] parseEngine3ResultJson null", JSON.stringify(sh));
    throw new Engine3CaseParseError(
      `Engine 3 konnte kein gültiges Ergebnis erzeugen (${lastErr}). Bitte erneut versuchen oder anderes Modell wählen.`,
      sh,
    );
  }

  resultData.goaeStandHinweis = resultData.goaeStandHinweis ??
    (rw === "EBM" ? EBM_STAND_HINWEIS : GOAE_STAND_HINWEIS);

  let finalData = applyRecalcAndConsistency(resultData, rw);
  finalData = applyEngine3AusschlussPass(finalData, rw);
  finalData = await critiqueRefineIfNeeded(p.apiKey, p.model, finalData, katalogMd, rw);
  finalData = applyRecalcAndConsistency(finalData, rw);
  finalData = applyEngine3AusschlussPass(finalData, rw);
  finalData = enforceEngine3Quellenbezug(finalData);
  finalData = ensureWarnungFehlerHaveUIFacingRationale(finalData);
  finalData = enrichEngine3BegruendungBeispiele(finalData);

  finalData.goaeStandHinweis = finalData.goaeStandHinweis ??
    (rw === "EBM" ? EBM_STAND_HINWEIS : GOAE_STAND_HINWEIS);
  finalData = filterEngine3AdminQuellenToEvidence(finalData);

  const quellenLines: string[] = p.kontextWissenEnabled
    ? (rw === "EBM"
      ? [
        "EBM (GKV): GOP- und Euro-Referenz (DocBill Katalogauszug)",
        `Eingabe: hochgeladene Datei(en) in diesem Vorgang (${p.quellenFileCount})`,
      ]
      : [
        "GOÄ-Paragraphen und Bewertungsregeln (eingebetteter DocBill-Referenzblock)",
        "GOÄ-Ziffern und Punktwerte (kontextbezogener Katalogauszug, DocBill JSON)",
        `Eingabe: hochgeladene Datei(en) in diesem Vorgang (${p.quellenFileCount})`,
      ])
    : [`Eingabe: hochgeladene Datei(en) in diesem Vorgang (${p.quellenFileCount})`];

  const seen = new Set(quellenLines);
  for (const a of finalData.adminQuellen ?? []) {
    const t = String(a).trim();
    const row = `Interner Kontext (RAG): ${t}`;
    if (t && !seen.has(row)) {
      seen.add(row);
      quellenLines.push(row);
    }
  }
  finalData.quellen = quellenLines;

  return finalData;
}
