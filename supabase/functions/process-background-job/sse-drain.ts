/** Minimaler SSE-Verarbeitung für Worker (kein gemeinsames Bundle mit Vite-Frontend). */

export type WorkerSseState = {
  assistantContent: string;
  invoiceData?: unknown;
  serviceBillingData?: unknown;
  engine3Data?: unknown;
  engine3Cases?: unknown[];
  engine3SegmentationProposal?: unknown;
  frageStructured?: unknown;
  docbillAnalyse?: unknown;
  hadSseError: boolean;
};

function handleDataLine(jsonStr: string, state: WorkerSseState): boolean {
  if (jsonStr === "[DONE]") return true;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return false;
  }

  const type = parsed.type as string | undefined;

  if (type === "pipeline_progress" || type === "service_billing_progress" || type === "engine3_progress") {
    return true;
  }

  if (type === "pipeline_result") {
    const raw = parsed.data as Record<string, unknown> | undefined;
    const pruefung =
      raw && typeof raw === "object" && "pruefung" in raw && raw.pruefung
        ? raw.pruefung
        : raw;
    const stammdaten = raw && typeof raw === "object" && "stammdaten" in raw ? raw.stammdaten : undefined;
    state.invoiceData = {
      positionen: (pruefung as { positionen?: unknown })?.positionen ?? [],
      optimierungen: (pruefung as { optimierungen?: unknown })?.optimierungen ?? [],
      zusammenfassung: (pruefung as { zusammenfassung?: unknown })?.zusammenfassung ?? {
        gesamt: 0,
        korrekt: 0,
        warnungen: 0,
        fehler: 0,
        rechnungsSumme: 0,
        korrigierteSumme: 0,
        optimierungsPotenzial: 0,
      },
      ...(stammdaten ? { stammdaten } : {}),
    };
    return true;
  }

  if (type === "pipeline_error" || type === "service_billing_error") {
    state.hadSseError = true;
    const err = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error);
    state.assistantContent += `\n\n❌ **Pipeline-Fehler:** ${err}`;
    return true;
  }

  if (type === "service_billing_result") {
    state.serviceBillingData = parsed.data;
    return true;
  }

  if (type === "engine3_segmentation_pending") {
    state.engine3SegmentationProposal = parsed.data;
    return true;
  }

  if (type === "engine3_case_result" || type === "engine3_result") {
    state.engine3Data = parsed.data;
    return true;
  }

  if (type === "engine3_batch_complete") {
    const casesRaw = parsed.cases;
    if (Array.isArray(casesRaw)) {
      state.engine3Cases = casesRaw;
      const first = casesRaw[0] as Record<string, unknown> | undefined;
      if (first?.data) state.engine3Data = first.data;
    }
    return true;
  }

  if (type === "engine3_error") {
    state.hadSseError = true;
    const errStr = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error);
    state.assistantContent += `\n\n❌ **Engine-3-Fehler:** ${errStr}`;
    return true;
  }

  if (type === "frage_structured") {
    state.frageStructured = parsed.data;
    return true;
  }

  if (type === "docbill_analyse") {
    state.docbillAnalyse = parsed.data;
    return true;
  }

  if (parsed.error) {
    state.hadSseError = true;
    const errMsg = (parsed.error as { message?: string })?.message ?? parsed.error;
    state.assistantContent += `\n\n❌ **Stream-Fehler:** ${typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg)}`;
    return true;
  }

  const c = (parsed.choices as { delta?: { content?: string } }[] | undefined)?.[0]?.delta?.content;
  if (typeof c === "string" && c) {
    state.assistantContent += c;
  }
  return true;
}

export async function drainGoaeSseToState(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<WorkerSseState> {
  const state: WorkerSseState = {
    assistantContent: "",
    hadSseError: false,
  };
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
      const ok = handleDataLine(jsonStr, state);
      if (!ok) {
        textBuffer = line + "\n" + textBuffer;
        break;
      }
    }
  }
  return state;
}

export function workerStateHasDeliverable(state: WorkerSseState): boolean {
  if (state.assistantContent.trim().length > 0) return true;
  if (state.frageStructured != null) return true;
  if (state.serviceBillingData != null) return true;
  if (state.invoiceData != null) return true;
  if (state.engine3Data != null) return true;
  if (state.engine3Cases != null && state.engine3Cases.length > 0) return true;
  if (state.engine3SegmentationProposal != null) return true;
  if (state.docbillAnalyse != null) return true;
  return false;
}

export function workerAssistantHasUserVisibleError(content: string): boolean {
  return /\n\n❌ \*\*(?:Pipeline-Fehler|Fehler|Stream-Fehler|Engine-3-Fehler):\*\* /.test(content);
}
