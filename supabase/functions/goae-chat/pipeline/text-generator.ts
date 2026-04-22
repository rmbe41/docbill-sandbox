/**
 * Step 6 – LLM zur Textgenerierung
 *
 * Erstellt verständliche Erklärungen und Optimierungsvorschläge
 * basierend auf den strukturierten Ergebnissen der Pipeline.
 *
 * Dies ist der EINZIGE Schritt, der streaming an den Client sendet.
 *
 *   PipelineResult → LLM (streaming) → formatierte Antwort
 */

import type { PipelineResult } from "./types.ts";
import { fetchWithTimeout } from "../fetch-with-timeout.ts";
import { GOAE_PARAGRAPHEN } from "../goae-paragraphen.ts";
import {
  GOAE_ANALOGE_BEWERTUNG,
  GOAE_BEGRUENDUNGEN,
} from "../goae-regeln.ts";
import {
  buildFallbackModels,
  isRetryableModelStatus,
  getReasoningConfigForStream,
} from "../model-resolver.ts";
import { getPseudonymRequestContext } from "../privacy/pseudonym-request-context.ts";
import { pseudonymizeForLlmSession } from "../privacy/pseudonymize-orchestrator.ts";
import { loadPseudonymMap } from "../privacy/pseudonym-redis.ts";
import { reidentifyText } from "../privacy/pseudonymize-bridge.ts";
import { completionTextFromJsonResponse } from "./direct-model.ts";

/** Timeout für Textgenerierung (90s) – verhindert endloses Hängen */
const TEXT_FETCH_TIMEOUT_MS = 90000;

const TEXT_SYSTEM_PROMPT = `Du bist GOÄ-DocBill, ein KI-Experte für die Analyse und Optimierung von Arztrechnungen.

Du erhältst die Ergebnisse einer automatischen **Rechnungsprüfung**. Die **Tabelle, Positionen und Annehmen/Ablehnen** rendert das Frontend — du wiederholst das **nicht**.

AUFGABE: **Sehr kurz** einordnen und **höchstens 4** Bullets (\`- \`) mit den wichtigsten **nächsten Schritten**. Priorität: harte Fehler (Ausschluss, Betrag) vor Warnungen. Keine Tabellen, keine langen Absätze.

WICHTIG:
- Keine erfundenen Prüfungen — nur aus den gelieferten Ergebnissen ableiten
- Deutsch
- **Nicht** die Labels **Korrekt:** oder **Zusatz:** am Zeilenanfang
- Steigerungsfaktor über Schwelle: **ein** Bullet mit knappem Begründungsvorschlag

⚠️ DATENSCHUTZ: keine personenbezogenen Daten; Patient nur als „Patient/in“.

## FORMAT (PFLICHT)

**Genau eine** Überschrift \`### Kurzfassung\`, darunter:
- **Ein** Absatz (**2 Sätze**): Fachgebiet + klinischer Kontext in Stichworten.
- **Dann** \`### Nächste Schritte\` mit **höchstens 4** Bullets (\`- \` oder \`- **Fehler:** …\` bei Ausschluss/Betrag).

Keine weiteren \`###\`, keine Emojis in Überschriften.
`;

const TEXT_SYSTEM_GOAE_BLOCK = `

DEIN KONTEXTWISSEN:

${GOAE_PARAGRAPHEN}

${GOAE_ANALOGE_BEWERTUNG}

${GOAE_BEGRUENDUNGEN}
`;

const TEXT_SYSTEM_NO_EMBEDDED_KNOWLEDGE = `

Hinweis: Es steht **kein** eingebetteter GOÄ-Katalog oder Regelwerk-Block zur Verfügung. Formuliere **zurückhaltend** bei GOÄ-Details; verlasse dich primär auf die strukturierten Prüfergebnisse in der Nutzernachricht.`;

function buildTextSystemPrompt(kontextWissenEnabled: boolean): string {
  return TEXT_SYSTEM_PROMPT + (kontextWissenEnabled ? TEXT_SYSTEM_GOAE_BLOCK : TEXT_SYSTEM_NO_EMBEDDED_KNOWLEDGE);
}

const TEXT_SYSTEM_NO_EBM_KNOWLEDGE = `

Hinweis: Es steht **kein** vollständiger EBM-Referenztext im System. Stütze dich auf die strukturierten Prüfergebnisse; formuliere zurückhaltend bei Euro-/GOP-Details.`;

const TEXT_EBM_BRIEF = `Du bist DocBill-EBM, ein KI-Assistent für **GKV-Abrechnung** (EBM, **GOP** fünf Stellen).

Wie bei GOÄ-DocBill: **kurze** Einordnung, **höchstens 4** Bullets Nächste Schritte, keine Tabelle, keine Wiederholung der UI.

WICHTIG:
- Regelwerk: **EBM** — Faktor/Steigerung i. d. R. **nicht** analog GOÄ; Betragsprüfung = Katalog (Punkte, Orientierungswert)
- Keine personenbezogenen Daten; Patient als „Patient/in“

## FORMAT: wie vorgegeben: \`### Kurzfassung\` (2 Sätze), \`### Nächste Schritte\` (max. 4 Bullets).`;

function buildTextSystemPromptEbm(kontextWissenEnabled: boolean): string {
  return TEXT_EBM_BRIEF + (kontextWissenEnabled ? "" : TEXT_SYSTEM_NO_EBM_KNOWLEDGE);
}

/** @deprecated Prefer buildTextSystemPrompt(true) — behält bisheriges Verhalten. */
const TEXT_SYSTEM_PROMPT_LEGACY = buildTextSystemPrompt(true);

export function buildTextGenerationPrompt(result: PipelineResult): string {
  const rw = result.regelwerk === "EBM" ? "EBM" : "GOAE";
  const posLabel = rw === "EBM" ? "GOP" : "GOÄ";
  const lines: string[] = [];

  lines.push("# Ergebnisse der automatischen Rechnungsprüfung\n");

  // Medizinischer Kontext
  lines.push("## Medizinischer Kontext");
  lines.push(`Fachgebiet: ${result.medizinischeAnalyse.fachgebiet}`);
  lines.push(`Kontext: ${result.medizinischeAnalyse.klinischerKontext}`);

  if (result.medizinischeAnalyse.diagnosen.length > 0) {
    lines.push("\nDiagnosen:");
    for (const d of result.medizinischeAnalyse.diagnosen) {
      lines.push(
        `- ${d.text}${d.icdCode ? ` (${d.icdCode})` : ""} [${d.sicherheit}]`,
      );
    }
  }

  // Geprüfte Positionen
  lines.push("\n## Geprüfte Positionen\n");
  for (const pos of result.pruefung.positionen) {
    lines.push(`### Position ${pos.nr}: ${posLabel} ${pos.ziffer} – ${pos.bezeichnung}`);
    lines.push(
      rw === "EBM"
        ? `Faktor: ${pos.faktor}× | Betrag: ${pos.betrag.toFixed(2)}€ | Katalog: ${pos.berechneterBetrag.toFixed(2)}€ | Prüfung: ${pos.status}`
        : `Faktor: ${pos.faktor}× | Betrag: ${pos.betrag.toFixed(2)}€ | Berechnet: ${pos.berechneterBetrag.toFixed(2)}€ | Prüfung: ${pos.status}`,
    );
    if (pos.begruendung) {
      lines.push(`Begründung: ${pos.begruendung}`);
    }

    if (pos.pruefungen.length > 0) {
      lines.push("Prüfungen:");
      for (const p of pos.pruefungen) {
        lines.push(`- [${p.schwere.toUpperCase()}] ${p.typ}: ${p.nachricht}`);
        if (p.vorschlag) lines.push(`  → Vorschlag: ${p.vorschlag}`);
      }
    }
    lines.push("");
  }

  // Optimierungen
  if (result.pruefung.optimierungen.length > 0) {
    lines.push("## Optimierungsvorschläge\n");
    for (const opt of result.pruefung.optimierungen) {
      lines.push(
        `- ${posLabel} ${opt.ziffer} (${opt.bezeichnung}): ${opt.faktor}× = ${opt.betrag.toFixed(2)}€`,
      );
      lines.push(`  Grund: ${opt.begruendung}`);
    }
    lines.push("");
  }

  // Zusammenfassung
  const z = result.pruefung.zusammenfassung;
  lines.push("## Zusammenfassung");
  lines.push(`- Gesamt: ${z.gesamt} Positionen`);
  lines.push(`- In Ordnung: ${z.korrekt}`);
  lines.push(`- Warnungen: ${z.warnungen}`);
  lines.push(`- Fehler: ${z.fehler}`);
  lines.push(`- Rechnungssumme: ${z.rechnungsSumme.toFixed(2)}€`);
  lines.push(`- Korrigierte Summe: ${z.korrigierteSumme.toFixed(2)}€`);
  lines.push(`- Optimierungspotenzial: +${z.optimierungsPotenzial.toFixed(2)}€`);

  return lines.join("\n");
}

/**
 * Startet den streaming LLM-Aufruf für die Textgenerierung.
 * Gibt den Response-Body als ReadableStream zurück.
 */
export async function generateTextStream(
  result: PipelineResult,
  apiKey: string,
  model: string,
  extraRules?: string,
  adminContext?: string,
  userMessage?: string,
  kontextWissenEnabled = true,
): Promise<ReadableStream<Uint8Array>> {
  let systemContent = result.regelwerk === "EBM"
    ? buildTextSystemPromptEbm(kontextWissenEnabled)
    : buildTextSystemPrompt(kontextWissenEnabled);
  if (adminContext) {
    systemContent += `\n\n## ADMIN-KONTEXT:\n${adminContext}`;
  }
  if (extraRules) {
    systemContent += `\n\n## ZUSÄTZLICHE REGELN:\n${extraRules}`;
  }
  if (userMessage?.trim()) {
    systemContent += `\n\n## NUTZERANWEISUNG (beachten!)\n\nDer Nutzer hat folgende Anweisung gegeben: „${userMessage.trim()}“\n\nBerücksichtige dies bei Analyse und Fazit: Priorisiere die genannten Aspekte, passe Detaillierungsgrad und Fokus entsprechend an.`;
  }

  const prompt = buildTextGenerationPrompt(result);

  const modelsToTry = buildFallbackModels(model);
  const reasoningConfig = getReasoningConfigForStream(model);
  let lastError = "Textgenerierung fehlgeschlagen";

  const pseudoCtx = getPseudonymRequestContext();
  let systemForApi = systemContent;
  let promptForApi = prompt;
  if (pseudoCtx) {
    systemForApi = (
      await pseudonymizeForLlmSession({
        plaintext: systemContent,
        sessionId: pseudoCtx.sessionId,
        apiKey: pseudoCtx.apiKey,
        model: pseudoCtx.model,
      })
    ).text;
    promptForApi = (
      await pseudonymizeForLlmSession({
        plaintext: prompt,
        sessionId: pseudoCtx.sessionId,
        apiKey: pseudoCtx.apiKey,
        model: pseudoCtx.model,
      })
    ).text;
  }

  for (let i = 0; i < modelsToTry.length; i++) {
    let response: Response;
    const reqBody: Record<string, unknown> = {
      model: modelsToTry[i],
      messages: [
        { role: "system", content: systemForApi },
        { role: "user", content: promptForApi },
      ],
      stream: pseudoCtx ? false : true,
      temperature: 0.3,
    };
    if (reasoningConfig) reqBody.reasoning = reasoningConfig;
    try {
      response = await fetchWithTimeout(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(reqBody),
          timeoutMs: TEXT_FETCH_TIMEOUT_MS,
        },
      );
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      lastError = isAbort
        ? `Textgenerierung Timeout (${TEXT_FETCH_TIMEOUT_MS / 1000}s) – Modell ${modelsToTry[i]} antwortet nicht`
        : (e instanceof Error ? e.message : String(e));
      if (i === modelsToTry.length - 1) throw new Error(lastError);
      continue;
    }

    if (response.ok) {
      if (pseudoCtx) {
        let text = await completionTextFromJsonResponse(response);
        const map = await loadPseudonymMap(pseudoCtx.sessionId);
        if (map?.mappings.length) text = reidentifyText(text, map);
        const enc = new TextEncoder();
        const chunkSize = 120;
        return new ReadableStream({
          start(controller) {
            for (let j = 0; j < text.length; j += chunkSize) {
              controller.enqueue(
                enc.encode(
                  `data: ${JSON.stringify({
                    choices: [{ delta: { content: text.slice(j, j + chunkSize) } }],
                  })}\n\n`,
                ),
              );
            }
            controller.close();
          },
        });
      }
      return response.body!;
    }

    const text = await response.text();
    lastError = `Textgenerierung fehlgeschlagen (${response.status}) mit Modell ${modelsToTry[i]}: ${text}`;
    if (!isRetryableModelStatus(response.status) || i === modelsToTry.length - 1) {
      throw new Error(lastError);
    }
  }

  throw new Error(lastError);
}

export { TEXT_SYSTEM_PROMPT_LEGACY as TEXT_SYSTEM_PROMPT };
