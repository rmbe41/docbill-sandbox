/**
 * Shared SSE utilities for pipeline streams.
 * Handles keep-alive, progress events, error serialization, and guaranteed cleanup.
 */

import type { PipelineProgress } from "./types.ts";

const DEFAULT_KEEP_ALIVE_MS = 8000;

export interface CreatePipelineStreamOptions {
  keepAliveMs?: number;
  /** Optional: add code to pipeline_error (e.g. FREE_MODELS_EXHAUSTED) */
  getErrorCode?: (errMsg: string) => string | undefined;
}

/**
 * Creates an SSE response with a background pipeline runner.
 * Guarantees cleanup (clearInterval, writer.close) in finally.
 */
export function createPipelineStream(
  steps: { label: string }[],
  run: (
    writer: WritableStreamDefaultWriter<Uint8Array>,
    sendProgress: (step: number, label: string) => Promise<void>,
  ) => Promise<void>,
  options: CreatePipelineStreamOptions = {},
): Response {
  const { keepAliveMs = DEFAULT_KEEP_ALIVE_MS, getErrorCode } = options;
  const encoder = new TextEncoder();

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  const sendProgress = async (step: number, label: string) => {
    const event: PipelineProgress = {
      step: step + 1,
      totalSteps: steps.length,
      label,
    };
    const data = `data: ${JSON.stringify({ type: "pipeline_progress", ...event })}\n\n`;
    await writer.write(encoder.encode(data));
  };

  const keepAliveInterval = setInterval(async () => {
    try {
      await writer.write(encoder.encode(": keepalive\n\n"));
    } catch {
      clearInterval(keepAliveInterval);
    }
  }, keepAliveMs);

  (async () => {
    try {
      await run(writer, sendProgress);
      await writer.close();
    } catch (error) {
      console.error("Pipeline stream error:", error);
      const errMsg = error instanceof Error ? error.message : "Pipeline-Fehler";
      const code = getErrorCode?.(errMsg);
      const data = `data: ${JSON.stringify({
        type: "pipeline_error",
        error: errMsg,
        ...(code && { code }),
      })}\n\n`;
      try {
        await writer.write(encoder.encode(data));
      } catch {
        /* writer may already be closed */
      }
      await writer.close().catch(() => {});
    } finally {
      clearInterval(keepAliveInterval);
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
