/**
 * Simple Pipeline-Orchestrator
 *
 * 2-Schritt-Engine: Parser + Admin-Context (parallel) → kombinierter LLM-Call (streaming).
 * Schneller als die 6-Schritt-Engine, liefert nur Streaming-Text (kein pipeline_result).
 *
 *   Rechnung → [Parser || Admin-Context] → LLM (GOÄ-Kontext + Analyse) → Streaming-Text
 */

import { parseDokumentWithRetry } from "./dokument-parser.ts";
import { fetchWithTimeout } from "../fetch-with-timeout.ts";
import { isFreeModel } from "../model-resolver.ts";
import { buildRelevantCatalog } from "../goae-catalog.ts";
import { GOAE_PARAGRAPHEN_KOMPAKT } from "../goae-paragraphen.ts";
import {
  GOAE_ANALOGE_BEWERTUNG,
  GOAE_BEGRUENDUNGEN,
  GOAE_ABSCHNITTE_KOMPAKT,
} from "../goae-regeln.ts";
import {
  buildFallbackModels,
  isRetryableModelStatus,
  getReasoningConfigForStream,
} from "../model-resolver.ts";
import { createPipelineStream } from "./sse-utils.ts";
import type { PipelineInput, ParsedRechnung } from "./types.ts";

const SIMPLE_PIPELINE_STEPS: { label: string }[] = [
  { label: "Dokument wird analysiert..." },
  { label: "Ergebnis wird erstellt..." },
];

const TEXT_FETCH_TIMEOUT_MS = 90000;
/** Max idle time waiting for next chunk from LLM stream – verhindert endloses Hängen */
const STREAM_READ_IDLE_TIMEOUT_MS = 60000;
const MAX_OUTPUT_TOKENS = 4096;

function buildSimplePrompt(parsed: ParsedRechnung): string {
  const lines: string[] = [];

  lines.push("# Extrahierte Rechnungsdaten\n");
  lines.push("## Rohtext\n");
  lines.push(parsed.rawText || "(kein Text)");
  lines.push("\n\n## Positionen\n");

  if (parsed.positionen.length > 0) {
    for (const p of parsed.positionen) {
      lines.push(
        `- Nr. ${p.nr}: GOÄ ${p.ziffer} – ${p.bezeichnung} | Faktor ${p.faktor}× | Betrag ${p.betrag.toFixed(2)}€${p.begruendung ? ` | Begründung: ${p.begruendung}` : ""}`,
      );
    }
  } else {
    lines.push("(keine strukturierten Positionen extrahiert)");
  }

  if (parsed.diagnosen?.length) {
    lines.push("\n## Diagnosen\n");
    for (const d of parsed.diagnosen) {
      lines.push(`- ${d}`);
    }
  }

  if (parsed.freitext?.trim()) {
    lines.push("\n## Freitext/Befund\n");
    lines.push(parsed.freitext);
  }

  return lines.join("\n");
}

function buildSimpleSystemPrompt(parsed: ParsedRechnung, kontextWissenEnabled = true): string {
  const katalog = buildRelevantCatalog(parsed);
  const goaeBlock = kontextWissenEnabled
    ? `

DEIN GOÄ-WISSEN:

${GOAE_PARAGRAPHEN_KOMPAKT}

${GOAE_ABSCHNITTE_KOMPAKT}

${katalog}

${GOAE_ANALOGE_BEWERTUNG}

${GOAE_BEGRUENDUNGEN}`
    : `

Hinweis: Es wurde **kein** GOÄ-Katalog- oder Regelwerk-Block in den Prompt eingebunden. Arbeite **zurückhaltend** bei GOÄ-Ziffern und Beträgen; priorisiere die extrahierten Rechnungsdaten.`;
  const goaeHint = kontextWissenEnabled
    ? "- Beziehe dich auf den GOÄ-Katalog im Kontext"
    : "- Kein eingebetteter GOÄ-Katalog: allgemeine Einordnung, Unsicherheit benennen";

  return `Du bist GOÄ-DocBill, ein KI-Experte für die Analyse und Optimierung von Arztrechnungen nach der Gebührenordnung für Ärzte (GOÄ).

AUSGANGSLAGE: Der Nutzer hat eine **bestehende Rechnung oder einen Abrechnungsbeleg** hochgeladen. Die folgenden Daten stammen aus dem Dokument (Extrakt).

DEINE AUFGABE: **Prüfen, regelkonform verbessern und konkrete Korrektur- sowie Optimierungsvorschläge** liefern – keine freie Neuerstellung ohne Bezug zu den extrahierten Positionen.

## PFLICHT-FORMAT (kompakt)

**Eine** Überschrift \`### Kurzfassung\`, darunter **ein** Absatz (2–3 Sätze) zu Kontext und Befund der Rechnung.

**Dann** \`### Nächste Schritte\` mit **höchstens 5** Bullets (\`- \`). Optional **eine** kleine Markdown-Tabelle (Nr. | GOÄ | Faktor | Betrag | Kurzanmerkung) nur wenn sie **≤ 8 Zeilen** bleibt — sonst nur Bullets, keine Tabellenwand.

Keine Emoji-Überschriften, keine Wiederholung langer Texte aus den Eingabedaten.

WICHTIG:
- Antworte IMMER auf Deutsch
- Verwende Euro-Beträge mit 2 Dezimalstellen
- Keine personenbezogenen Daten
${goaeHint}
${goaeBlock}
`;
}

export async function runSimplePipeline(
  input: PipelineInput,
  getAdminContext: () => Promise<string>,
): Promise<Response> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")!;

  const encoder = new TextEncoder();
  return createPipelineStream(
    SIMPLE_PIPELINE_STEPS,
    async (writer, sendProgress) => {
      await sendProgress(0, SIMPLE_PIPELINE_STEPS[0].label);

      const [parsedRechnung, adminContext] = await Promise.all([
        parseDokumentWithRetry(input.files, apiKey, input.model, {
          multiDocumentInvoiceReview: input.files.length >= 2,
        }),
        getAdminContext().catch(() => ""),
      ]);

      await sendProgress(1, SIMPLE_PIPELINE_STEPS[1].label);

      const kontextOk = input.kontextWissenEnabled !== false;
      let systemContent = buildSimpleSystemPrompt(parsedRechnung, kontextOk);
      if (adminContext) {
        systemContent += `\n\n## ADMIN-KONTEXT:\n${adminContext}`;
      }
      if (input.extraRules) {
        systemContent += `\n\n## ZUSÄTZLICHE REGELN:\n${input.extraRules}`;
      }
      if (input.userMessage?.trim()) {
        systemContent += `\n\n## NUTZERANWEISUNG:\n„${input.userMessage.trim()}“\n\nBerücksichtige dies bei der Analyse.`;
      }

      const userPrompt = buildSimplePrompt(parsedRechnung);
      const modelsToTry = buildFallbackModels(input.model);
      const reasoningConfig = getReasoningConfigForStream(input.model);
      let lastError = "Textgenerierung fehlgeschlagen";

      for (let i = 0; i < modelsToTry.length; i++) {
        let response: Response;
        const reqBody: Record<string, unknown> = {
          model: modelsToTry[i],
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: userPrompt },
          ],
          stream: true,
          temperature: 0.3,
          max_tokens: MAX_OUTPUT_TOKENS,
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
            ? `Textgenerierung Timeout (${TEXT_FETCH_TIMEOUT_MS / 1000}s)`
            : (e instanceof Error ? e.message : String(e));
          if (i === modelsToTry.length - 1) throw new Error(lastError);
          continue;
        }

        if (response.ok && response.body) {
          const reader = response.body.getReader();
          while (true) {
            let result: ReadableStreamReadResult<Uint8Array>;
            let timeoutId: ReturnType<typeof setTimeout>;
            const timeoutPromise = new Promise<never>((_, reject) => {
              timeoutId = setTimeout(
                () => reject(new Error(`Stream idle timeout (${STREAM_READ_IDLE_TIMEOUT_MS / 1000}s)`)),
                STREAM_READ_IDLE_TIMEOUT_MS,
              );
            });
            try {
              result = await Promise.race([reader.read(), timeoutPromise]);
              clearTimeout(timeoutId);
            } catch (e) {
              clearTimeout(timeoutId);
              lastError = e instanceof Error ? e.message : String(e);
              await reader.cancel().catch(() => {});
              break;
            }
            const { done, value } = result;
            if (done) break;
            await writer.write(value);
          }
          if (lastError) {
            if (i < modelsToTry.length - 1) continue;
            throw new Error(lastError);
          }
          return;
        }

        const text = await response.text();
        lastError = `Textgenerierung fehlgeschlagen (${response.status}): ${text}`;
        if (!isRetryableModelStatus(response.status) || i === modelsToTry.length - 1) {
          throw new Error(lastError);
        }
      }

      throw new Error(lastError);
    },
    {
      getErrorCode: (errMsg) => {
        const looksLikeModelFailure = /fehlgeschlagen|Kein Modell|nicht verfügbar/i.test(errMsg);
        return isFreeModel(input.model) && looksLikeModelFailure ? "FREE_MODELS_EXHAUSTED" : undefined;
      },
    },
  );
}
