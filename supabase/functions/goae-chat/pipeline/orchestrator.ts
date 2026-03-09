/**
 * Pipeline-Orchestrator
 *
 * Koordiniert alle Pipeline-Schritte und sendet Progress-Events
 * via SSE an den Client.
 *
 *   Rechnung → Parser → NLP → Extraktion → Mapping → Regelengine → Textgenerierung
 *     ↕ SSE-Progress an Frontend
 */

import { parseDokument } from "./dokument-parser.ts";
import { analysiereMedizinisch } from "./medizinisches-nlp.ts";
import { extrahiereLeistungen } from "./leistungs-extraktion.ts";
import { mappeGoae } from "./goae-mapping.ts";
import { pruefeRechnung } from "./regelengine.ts";
import { generateTextStream, buildTextGenerationPrompt } from "./text-generator.ts";
import { GOAE_KATALOG } from "../goae-catalog.ts";
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
  adminContext: string,
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
      data: result.pruefung,
    })}\n\n`;
    await writer.write(encoder.encode(data));
  };

  // Run the pipeline in the background, writing to the stream
  (async () => {
    try {
      // Step 1: Dokument Parser
      await sendProgress(0, PIPELINE_STEPS[0].label);
      const parsedRechnung = await parseDokument(
        input.files,
        apiKey,
        input.model,
      );

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
        GOAE_KATALOG,
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

      // Step 6: Textgenerierung (streaming)
      await sendProgress(5, PIPELINE_STEPS[5].label);
      const textStream = await generateTextStream(
        pipelineResult,
        apiKey,
        input.model,
        input.extraRules,
        adminContext,
      );

      // Pipe the text generation stream through
      const reader = textStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }

      await writer.close();
    } catch (error) {
      console.error("Pipeline error:", error);
      const errMsg =
        error instanceof Error ? error.message : "Pipeline-Fehler";
      const data = `data: ${JSON.stringify({
        type: "pipeline_error",
        error: errMsg,
      })}\n\n`;
      await writer.write(encoder.encode(data));
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

export { buildTextGenerationPrompt };
