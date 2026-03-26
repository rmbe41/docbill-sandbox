/**
 * Intent-Klassifikator für automatische Workflow-Erkennung.
 *
 * Ermittelt aus Nutzer-Nachricht und optionalen Dateien den passenden Workflow:
 * - rechnung_pruefen: Rechnung hochladen und prüfen/korrigieren
 * - leistungen_abrechnen: Erbrachte Leistungen beschreiben → GOÄ-Vorschläge
 * - frage: GOÄ-Frage stellen
 */

import { callLlm, extractJson } from "./pipeline/llm-client.ts";
import { resolveModel } from "./model-resolver.ts";
import { inferWelcomeStickyWorkflow } from "./infer-welcome-sticky.ts";

export type WorkflowIntent = "rechnung_pruefen" | "leistungen_abrechnen" | "frage";

export interface IntentClassifierInput {
  userMessage: string;
  hasFiles: boolean;
  /** Letzte Nachrichten aus dem Chat-Verlauf (für Kontext bei Follow-ups) */
  recentMessages?: { role: string; content: string }[];
}

const INTENT_SYSTEM_PROMPT = `Du bist ein Intent-Klassifikator für eine GOÄ-Abrechnungs-App (DocBill).

AUFGABE: Bestimme den Workflow-Intent aus der Nutzer-Nachricht. Antworte NUR mit einem JSON-Objekt:

{
  "workflow": "rechnung_pruefen" | "leistungen_abrechnen" | "frage",
  "confidence": "hoch" | "mittel" | "niedrig"
}

WORKFLOW-DEFINITIONEN:

1. rechnung_pruefen: Nutzer möchte eine **bereits erstellte Rechnung/Abrechnung/Beleg/Honoraraufstellung** prüfen, korrigieren oder verbessern.
   - Formulierungen wie: Rechnung prüfen/kontrollieren/korrigieren, „stimmt diese Abrechnung“, Beleg, Honorarliste
   - **Auch ohne Datei:** kurze Anfragen wie „Rechnung prüfen“, „bitte Rechnung kontrollieren“ → **rechnung_pruefen** (Upload folgt später).
   - Dateien: typischerweise fertige Rechnung als PDF/Bild

2. leistungen_abrechnen: Aus **Patientenakte, Arztbrief, Befund, OP-/Ambulanzbericht, Leistungsliste** oder Freitext zu **erbrachten Leistungen** soll ein **GOÄ-/Rechnungsvorschlag** abgeleitet werden (noch keine fertige Rechnung im Fokus).
   - Akte, Befundbericht, Liste erbrachter Services, „was kann ich abrechnen“, „welche GOÄ-Ziffern“, „Rechnungsvorschlag aus dem Dokument“
   - Dateien: klinische Dokumentation, keine Honorarrechnung zum Prüfen
   - Auch ohne Dateien: Beschreibung erbrachter Leistungen inkl. Abrechnungswunsch

3. frage: Reine **informative GOÄ-Frage** ohne Upload und ohne Bitte um einen konkreten Rechnungsvorschlag aus Akte/Text.
   - „Was bedeutet Ziffer 1240?“, „Darf ich X und Y nebeneinander abrechnen?“
   - Fallback bei Unklarheit **ohne Datei**
   - **Mit Datei:** fast nie „frage“ – dann meist leistungen_abrechnen oder rechnung_pruefen

REGELN (Priorität):
- **Datei + Akte/Befund/Bericht/Leistungsliste/abrechnen wollen** (ohne „Rechnung prüfen“) → leistungen_abrechnen
- **Datei + Rechnung/Beleg prüfen/kontrollieren** → rechnung_pruefen
- Kurze Nachricht + Datei ohne Kontext: wenn eher klinisches Dokument möglich → leistungen_abrechnen, wenn eher Rechnung → rechnung_pruefen; bei Zweifel **leistungen_abrechnen** wenn „abrechnen/was kann“ vorkommt, sonst rechnung_pruefen
- Keine Datei + erbrachte Leistungen / Abrechnungswunsch → leistungen_abrechnen
- Keine Datei + reine Wissensfrage → frage

FOLLOW-UP NACH WELCOME-SCREEN (DocBill-Einstieg, erste Nutzerzeile oft wörtlich der Button):
- War die **erste** Nutzernachricht „Leistungen abrechnen“ und liefert die **aktuelle** Nachricht erbrachte Leistungen (Liste, Freitext, OP/Ambulanz), optional mit Datei → **leistungen_abrechnen** (nicht „frage“).
- War die erste Nachricht „Rechnung prüfen“ und der Nutzer lädt nun Rechnung und/oder Akte/Befund hoch oder beschreibt die Unterlagen → **rechnung_pruefen**.
- War die erste Nachricht eine **Frage öffnen**-Formulierung („Ich möchte eine Frage stellen“) und die Folgenachricht ist inhaltlich eine Wissensfrage → **frage**.`;

/** Heuristische Fallback-Logik, wenn LLM nicht verfügbar oder fehlschlägt */
export function classifyByHeuristics(input: IntentClassifierInput): WorkflowIntent {
  const msg = (input.userMessage || "").toLowerCase().trim();
  const sticky = inferWelcomeStickyWorkflow(input.recentMessages);

  const currentWantsRechnungPruefen =
    /\b(rechnung|honoraraufstellung|abrechnungsbeleg|honorarliste)\b/.test(msg) &&
    (/\bprüf/.test(msg) ||
      /\bkontroll/.test(msg) ||
      /\bkorrigier/.test(msg) ||
      /\bstimmt\b/.test(msg) ||
      /\bkorrekt\b/.test(msg));

  if (sticky === "leistungen_abrechnen") {
    if (
      currentWantsRechnungPruefen &&
      !/\b(akte|befund|leistung|vorschlag|ambulanz|op\b|untersuch)\b/.test(msg)
    ) {
      return "rechnung_pruefen";
    }
    return "leistungen_abrechnen";
  }

  if (sticky === "rechnung_pruefen") {
    return "rechnung_pruefen";
  }

  if (sticky === "frage" && !input.hasFiles) {
    return "frage";
  }

  // Rechnung prüfen: Dateien + Rechnungs-Keywords
  if (input.hasFiles) {
    const rechnungPruefenKeywords = [
      "prüfen",
      "prüfe",
      "kontrollieren",
      "kontrolliere",
      "korrigieren",
      "ist das korrekt",
      "stimmt das",
      "rechnungsbeleg",
      "honoraraufstellung",
    ];
    const hatRechnungsbezug =
      /\brechnung\b/.test(msg) ||
      /\babrechnungsbeleg\b/.test(msg) ||
      /\bkv-abrechnung\b/.test(msg);
    const akteOderLeistungsVorschlag = [
      "patientenakte",
      "akte",
      "befund",
      "arztbrief",
      "ambulanz",
      "leistungsliste",
      "was kann ich",
      "welche ziffer",
      "welche goä",
      "erbrachte",
      "erbracht",
      "durchgeführt",
      "rechnungsvorschlag",
      "bitte abrechnen",
    ];
    if (
      akteOderLeistungsVorschlag.some((k) => msg.includes(k)) &&
      !rechnungPruefenKeywords.some((k) => msg.includes(k)) &&
      !(hatRechnungsbezug && /\b(prüf|kontroll|korrekt|stimmt)\b/.test(msg))
    ) {
      return "leistungen_abrechnen";
    }
    if (rechnungPruefenKeywords.some((k) => msg.includes(k)) || hatRechnungsbezug) {
      return "rechnung_pruefen";
    }
    return "rechnung_pruefen";
  }

  // Keine Dateien: Text-basiert (Wortstämme: „prüfen“, „kontrollieren“, …)
  if (
    /\b(rechnung|honoraraufstellung|abrechnungsbeleg|honorarliste)\b/.test(msg) &&
    (/\bprüf/.test(msg) ||
      /\bkontroll/.test(msg) ||
      /\bkorrigier/.test(msg) ||
      /\boptimier/.test(msg) ||
      /\bverbesser/.test(msg) ||
      /\bfehlend/.test(msg) ||
      /\bstimmt\b/.test(msg) ||
      /\bkorrekt\b/.test(msg))
  ) {
    return "rechnung_pruefen";
  }

  const leistungKeywords = [
    "habe gemacht",
    "habe durchgeführt",
    "durchgeführt",
    "was kann ich abrechnen",
    "welche ziffer",
    "welche goä",
    "abrechnen",
    "erbracht",
    "untersucht",
    "behandelt",
  ];
  if (leistungKeywords.some((k) => msg.includes(k))) {
    return "leistungen_abrechnen";
  }

  const frageKeywords = [
    "wie oft",
    "was bedeutet",
    "darf ich",
    "kann ich",
    "was ist",
    "woher",
    "warum",
    "?",
  ];
  if (frageKeywords.some((k) => msg.includes(k)) || msg.endsWith("?")) {
    return "frage";
  }

  // Kurze Nachrichten ohne klaren Indikator → frage
  if (msg.length < 30) return "frage";

  // Fachbezug ohne klare Rechnungsprüfung → Leistungsabrechnung / Kontext (nicht „Rechnung prüfen“)
  if (/\b(goä|ziffer|abrechnen|patient|behandlung|untersuchung)\b/i.test(msg)) {
    return "leistungen_abrechnen";
  }
  if (
    /\brechnung\b/.test(msg) &&
    /\b(schreiben|erstellen|ausstellen|formulier|neue\s+rechnung|rechnungsvorschlag)\b/.test(msg)
  ) {
    return "leistungen_abrechnen";
  }
  if (/\brechnung\b/.test(msg)) {
    return "rechnung_pruefen";
  }
  return "frage";
}

export async function classifyIntent(
  input: IntentClassifierInput,
  apiKey: string,
  model: string,
): Promise<{ workflow: WorkflowIntent; confidence: "hoch" | "mittel" | "niedrig" }> {
  const resolvedModel = resolveModel(model);

  try {
    const contextParts: string[] = [];
    if (input.recentMessages && input.recentMessages.length > 0) {
      const lastFew = input.recentMessages.slice(-6);
      contextParts.push(
        "Chat-Verlauf (letzte Nachrichten):",
        ...lastFew.map((m) => `[${m.role}]: ${m.content.slice(0, 200)}`),
      );
    }

    const userContent = [
      {
        type: "text",
        text: [
          `Nutzer-Nachricht: "${input.userMessage}"`,
          `Dateien hochgeladen: ${input.hasFiles ? "ja" : "nein"}`,
          ...(contextParts.length > 0 ? ["", ...contextParts] : []),
        ].join("\n"),
      },
    ];

    const raw = await callLlm({
      apiKey,
      model: resolvedModel,
      systemPrompt: INTENT_SYSTEM_PROMPT,
      userContent,
      jsonMode: true,
      temperature: 0,
      maxTokens: 128,
    });

    const result = extractJson<{
      workflow: WorkflowIntent;
      confidence: "hoch" | "mittel" | "niedrig";
    }>(raw);

    const workflow = result.workflow ?? classifyByHeuristics(input);
    const confidence = result.confidence ?? "mittel";

    return { workflow, confidence };
  } catch {
    return {
      workflow: classifyByHeuristics(input),
      confidence: "niedrig",
    };
  }
}
