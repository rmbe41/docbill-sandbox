/**
 * Pipeline-Orchestrator
 *
 * Koordiniert alle Pipeline-Schritte und sendet Progress-Events
 * via SSE an den Client.
 *
 *   Rechnung → Parser → NLP → Extraktion → Mapping → Regelengine → Textgenerierung
 *     ↕ SSE-Progress an Frontend
 */

import { parseDokumentWithRetry } from "./dokument-parser.ts";
import { analysiereMedizinisch } from "./medizinisches-nlp.ts";
import { extrahiereLeistungen } from "./leistungs-extraktion.ts";
import { mappeGoae } from "./goae-mapping.ts";
import { pruefeRechnung } from "./regelengine.ts";
import { generateTextStream, buildTextGenerationPrompt } from "./text-generator.ts";
import { isFreeModel } from "../model-resolver.ts";
import type {
  PipelineInput,
  PipelineResult,
  PipelineProgress,
} from "./types.ts";

const PIPELINE_STEPS: { label: string }[] = [
  { label: "Dokument wird analysiert..." },
  { label: "Medizinische Inhalte werden erkannt..." },
  { label: "Leistungen werden extrahiert..." },
  { label: "GOÄ-Zuordnung wird geprüft..." },
  { label: "Regelprüfung wird durchgeführt..." },
  { label: "Ergebnis wird erstellt..." },
];

export async function runPipeline(
  input: PipelineInput,
  getAdminContext: (result?: PipelineResult) => Promise<string>,
): Promise<Response> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")!;

  const encoder = new TextEncoder();

  // We build a TransformStream that sends progress events first,
  // then pipes the text generation stream through.
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const sendProgress = async (step: number, label: string) => {
    const event: PipelineProgress = {
      step: step + 1,
      totalSteps: PIPELINE_STEPS.length,
      label,
    };
    const data = `data: ${JSON.stringify({ type: "pipeline_progress", ...event })}\n\n`;
    await writer.write(encoder.encode(data));
  };

  const sendPipelineResult = async (result: PipelineResult) => {
    const data = `data: ${JSON.stringify({
      type: "pipeline_result",
      data: {
        pruefung: result.pruefung,
        stammdaten: result.parsedRechnung.stammdaten,
      },
    })}\n\n`;
    await writer.write(encoder.encode(data));
  };

  // Keep-alive: Send SSE comment every 8s to prevent proxy/load-balancer timeouts
  // during long LLM calls (e.g. parseDokument can take 20–40s)
  const KEEP_ALIVE_MS = 8000;
  const keepAliveInterval = setInterval(async () => {
    try {
      await writer.write(encoder.encode(": keepalive\n\n"));
    } catch {
      clearInterval(keepAliveInterval);
    }
  }, KEEP_ALIVE_MS);

  // Run the pipeline in the background, writing to the stream
  (async () => {
    try {
      // Step 1: Dokument Parser (mit Retry bei unplausiblen Ergebnissen)
      await sendProgress(0, PIPELINE_STEPS[0].label);
      const parsedRechnung = await parseDokumentWithRetry(input.files, apiKey, input.model, {
        multiDocumentInvoiceReview: input.files.length >= 2,
      });

      // Step 2: Medizinisches NLP
      await sendProgress(1, PIPELINE_STEPS[1].label);
      const medizinischeAnalyse = await analysiereMedizinisch(
        parsedRechnung,
        apiKey,
        input.model,
      );

      // Step 3: Leistungs-Extraktion (deterministic)
      await sendProgress(2, PIPELINE_STEPS[2].label);
      const leistungen = extrahiereLeistungen(
        parsedRechnung,
        medizinischeAnalyse,
      );

      // Step 4: GOÄ Mapping
      await sendProgress(3, PIPELINE_STEPS[3].label);
      const mappings = await mappeGoae(
        parsedRechnung,
        leistungen,
        medizinischeAnalyse,
        apiKey,
        input.model,
      );

      // Step 5: Regelengine (deterministic)
      await sendProgress(4, PIPELINE_STEPS[4].label);
      const pruefung = pruefeRechnung(
        parsedRechnung,
        medizinischeAnalyse,
        mappings,
        "",
      );

      const pipelineResult: PipelineResult = {
        parsedRechnung,
        medizinischeAnalyse,
        leistungen,
        mappings,
        pruefung,
      };

      // Send structured result for frontend storage
      await sendPipelineResult(pipelineResult);

      // Intro-Text vor Stream – Fallback bei Client-Timeout, damit message.content nie leer bleibt
      const explanationIntro = `data: ${JSON.stringify({
        choices: [{ delta: { content: "Die detaillierte Erklärung:\n\n" } }],
      })}\n\n`;
      await writer.write(encoder.encode(explanationIntro));

      // Step 6: Textgenerierung (streaming)
      await sendProgress(5, PIPELINE_STEPS[5].label);
      const adminContext = await getAdminContext(pipelineResult);
      const textStream = await generateTextStream(
        pipelineResult,
        apiKey,
        input.model,
        input.extraRules,
        adminContext,
        input.userMessage,
      );

      // Pipe the text generation stream through
      const reader = textStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }

      clearInterval(keepAliveInterval);
      await writer.close();
    } catch (error) {
      clearInterval(keepAliveInterval);
      console.error("Pipeline error:", error);
      const errMsg =
        error instanceof Error ? error.message : "Pipeline-Fehler";
      const looksLikeModelFailure = /fehlgeschlagen|Kein Modell|nicht verfügbar/i.test(errMsg);
      const code = isFreeModel(input.model) && looksLikeModelFailure ? "FREE_MODELS_EXHAUSTED" : undefined;
      const data = `data: ${JSON.stringify({
        type: "pipeline_error",
        error: errMsg,
        ...(code && { code }),
      })}\n\n`;
      await writer.write(encoder.encode(data));
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Prevent nginx from buffering SSE
    },
  });
}

export { buildTextGenerationPrompt };
