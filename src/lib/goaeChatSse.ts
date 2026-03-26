import type { InvoiceResultData } from "@/components/InvoiceResult";
import type { ServiceBillingResultData } from "@/components/ServiceBillingResult";
import type { FrageAnswerStructured } from "@/lib/frageAnswerStructured";
import { filterExplicitQuellenEntries } from "@/lib/quellenMetaFilter";

export type PipelineProgressPayload = {
  step: number;
  totalSteps: number;
  label: string;
};

export type SseAccumState = {
  assistantContent: string;
  invoiceData?: InvoiceResultData;
  serviceBillingData?: ServiceBillingResultData;
  frageStructured?: FrageAnswerStructured;
};

export type SseHandlerContext = {
  state: SseAccumState;
  onProgress: (p: PipelineProgressPayload | null) => void;
  onDelta: () => void;
  onFreeModelsExhausted?: (details: string | null) => void;
};

/** Parse one SSE line after "data: " into JSON; returns null if incomplete. */
export function handleGoaeSseDataLine(jsonStr: string, ctx: SseHandlerContext): boolean {
  if (jsonStr === "[DONE]") return true;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return false;
  }

  const type = parsed.type as string | undefined;

  if (type === "pipeline_progress" || type === "service_billing_progress") {
    const step = (parsed.step as number) ?? 1;
    const total = (parsed.totalSteps as number) ?? 6;
    const label = (parsed.label as string) ?? "";
    ctx.onProgress({ step, totalSteps: total, label });
    return true;
  }

  if (type === "pipeline_result") {
    ctx.onProgress(null);
    const raw = parsed.data as
      | { pruefung?: InvoiceResultData; stammdaten?: InvoiceResultData["stammdaten"] }
      | InvoiceResultData;
    const pruefung =
      raw && typeof raw === "object" && "pruefung" in raw && raw.pruefung
        ? raw.pruefung
        : (raw as InvoiceResultData);
    const stammdaten = raw && typeof raw === "object" && "stammdaten" in raw ? raw.stammdaten : undefined;
    ctx.state.invoiceData = {
      positionen: pruefung?.positionen ?? [],
      optimierungen: pruefung?.optimierungen ?? [],
      zusammenfassung: pruefung?.zusammenfassung ?? {
        gesamt: 0,
        korrekt: 0,
        warnungen: 0,
        fehler: 0,
        rechnungsSumme: 0,
        korrigierteSumme: 0,
        optimierungsPotenzial: 0,
      },
      ...(stammdaten && { stammdaten }),
    };
    ctx.onDelta();
    return true;
  }

  if (type === "pipeline_error") {
    ctx.onProgress(null);
    ctx.state.assistantContent += `\n\n❌ **Pipeline-Fehler:** ${parsed.error as string}`;
    if (parsed.code === "FREE_MODELS_EXHAUSTED") {
      ctx.onFreeModelsExhausted?.(
        (parsed.error as string) ?? (parsed.details as string) ?? null,
      );
    }
    ctx.onDelta();
    return true;
  }

  if (type === "service_billing_result") {
    ctx.onProgress(null);
    ctx.state.serviceBillingData = parsed.data as ServiceBillingResultData;
    ctx.onDelta();
    return true;
  }

  if (type === "service_billing_error") {
    ctx.onProgress(null);
    ctx.state.assistantContent += `\n\n❌ **Fehler:** ${parsed.error as string}`;
    ctx.onDelta();
    return true;
  }

  if (type === "frage_structured") {
    const raw = parsed.data as Record<string, unknown> | undefined;
    if (raw && typeof raw === "object") {
      const kurz = raw.kurzantwort;
      const erl = raw.erlaeuterung;
      let quellen = raw.quellen;
      if (typeof quellen === "string") quellen = [quellen];
      if (!Array.isArray(quellen)) quellen = [];
      const quellenStr = filterExplicitQuellenEntries(
        quellen.filter((x): x is string => typeof x === "string"),
      );
      const grenzRaw = raw.grenzfaelle_hinweise;
      const grenz = typeof grenzRaw === "string" ? grenzRaw : "";
      if (typeof kurz === "string" && typeof erl === "string") {
        ctx.state.frageStructured = {
          kurzantwort: kurz,
          erlaeuterung: erl,
          quellen: quellenStr,
          grenzfaelle_hinweise: grenz,
        };
        ctx.onDelta();
      }
    }
    return true;
  }

  if (parsed.error) {
    const errMsg = (parsed.error as { message?: string })?.message ?? parsed.error;
    ctx.state.assistantContent += `\n\n❌ **Stream-Fehler:** ${typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg)}`;
    ctx.onDelta();
    return true;
  }

  const c = (parsed.choices as { delta?: { content?: string } }[] | undefined)?.[0]?.delta?.content;
  if (typeof c === "string" && c) {
    ctx.state.assistantContent += c;
    ctx.onDelta();
  }

  return true;
}

/** True when the stream appended one of our SSE error blocks (pipeline / billing / stream). */
export function assistantContentHasSseError(content: string): boolean {
  return /\n\n❌ \*\*(?:Pipeline-Fehler|Fehler|Stream-Fehler):\*\* /.test(content);
}

/** True when the stream produced something we can show (text or a structured result event). */
export function sseAccumStateHasDeliverable(state: SseAccumState): boolean {
  if ((state.assistantContent ?? "").trim().length > 0) return true;
  if (state.frageStructured != null) return true;
  if (state.serviceBillingData != null) return true;
  if (state.invoiceData != null) return true;
  return false;
}

/** First line of the SSE error message for persistence (e.g. job.error). */
export function sseErrorSummaryFromAssistantContent(content: string): string {
  const m = content.match(
    /\n\n❌ \*\*(?:Pipeline-Fehler|Fehler|Stream-Fehler):\*\* ([^\n]+)/,
  );
  const line = m?.[1]?.trim();
  if (line) return line.length > 220 ? `${line.slice(0, 217)}…` : line;
  return "Pipeline- oder Stream-Fehler";
}

export async function consumeGoaeChatSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ctx: SseHandlerContext,
): Promise<void> {
  const decoder = new TextDecoder();
  let textBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    textBuffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
      let line = textBuffer.slice(0, newlineIndex);
      textBuffer = textBuffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || line.trim() === "") continue;
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      const ok = handleGoaeSseDataLine(jsonStr, ctx);
      if (!ok) {
        textBuffer = line + "\n" + textBuffer;
        break;
      }
    }
  }
}
