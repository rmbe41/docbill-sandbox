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

1. rechnung_pruefen: Nutzer möchte eine bestehende Rechnung prüfen, kontrollieren oder korrigieren.
   - Hat Dateien hochgeladen UND spricht von Rechnung/Prüfung/Kontrolle
   - Oder: "prüfe meine Rechnung", "kontrolliere diese Abrechnung", "ist das korrekt?"
   - Dateien sind typischerweise PDF/Bild einer fertigen Rechnung

2. leistungen_abrechnen: Nutzer beschreibt erbrachte Leistungen und möchte wissen, was er abrechnen kann.
   - Beschreibung von Untersuchungen/Behandlungen: "habe gemacht", "durchgeführt", "was kann ich abrechnen"
   - "Ich habe Funduskopie und IOD gemessen – was kann ich abrechnen?"
   - Dateien können Behandlungsbericht/Arztbrief sein (keine Rechnung)
   - Auch ohne Dateien: reine Textbeschreibung erbrachter Leistungen

3. frage: Nutzer stellt eine allgemeine GOÄ-Frage.
   - "Wie oft darf ich GOÄ 401 im Quartal ansetzen?"
   - "Was bedeutet Ziffer 1240?"
   - "Darf ich X und Y nebeneinander abrechnen?"
   - Fallback bei Unklarheit

REGELN:
- Bei Dateien + expliziter Rechnungsbezug → rechnung_pruefen
- Bei Dateien + Beschreibung von Behandlungen/Leistungen (ohne Rechnungsbezug) → leistungen_abrechnen
- Bei reinem Text + Beschreibung erbrachter Leistungen → leistungen_abrechnen
- Bei reinem Text + Frageformat → frage
- Bei Unklarheit → frage (sicherer Fallback)`;

/** Heuristische Fallback-Logik, wenn LLM nicht verfügbar oder fehlschlägt */
function classifyByHeuristics(input: IntentClassifierInput): WorkflowIntent {
  const msg = (input.userMessage || "").toLowerCase().trim();

  // Rechnung prüfen: Dateien + Rechnungs-Keywords
  if (input.hasFiles) {
    const rechnungKeywords = [
      "prüfen",
      "prüfe",
      "kontrollieren",
      "kontrolliere",
      "rechnung",
      "abrechnung",
      "korrigieren",
      "ist das korrekt",
      "stimmt das",
    ];
    if (rechnungKeywords.some((k) => msg.includes(k))) {
      return "rechnung_pruefen";
    }
    // Dateien ohne klaren Rechnungsbezug → Standard: Rechnung (Parser entscheidet später)
    return "rechnung_pruefen";
  }

  // Keine Dateien: Text-basiert
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

  // Längere Beschreibungen → eher leistungen_abrechnen
  return "leistungen_abrechnen";
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
      const lastFew = input.recentMessages.slice(-4);
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
