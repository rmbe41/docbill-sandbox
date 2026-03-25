/**
 * NDJSON stream from supabase/functions/admin-context-upload (upload path only).
 */

export type AdminContextUploadComplete = {
  type: "complete";
  ok: true;
  file_id?: string;
  chunks?: number;
  truncated?: boolean;
  max_chunks?: number;
  estimated_input_tokens_approx?: number;
};

export async function consumeAdminContextUploadStream(
  response: Response,
  onProgress: (step: string, skipped?: boolean) => void,
): Promise<
  | { ok: true; file_id?: string; chunks?: number; truncated?: boolean; max_chunks?: number; estimated_input_tokens_approx?: number }
  | { ok: false; message: string }
> {
  if (!response.ok) {
    const text = await response.text();
    try {
      const j = JSON.parse(text) as { error?: string };
      return { ok: false, message: typeof j.error === "string" ? j.error : text || response.statusText };
    } catch {
      return { ok: false, message: text || response.statusText };
    }
  }

  if (!response.body) {
    return { ok: false, message: "Keine Antwort vom Server" };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete: AdminContextUploadComplete | null = null;
  let errMsg: string | null = null;

  const handleLine = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.type === "progress" && typeof msg.step === "string") {
      onProgress(msg.step, msg.skipped === true);
    }
    if (msg.type === "complete" && msg.ok === true) {
      complete = msg as AdminContextUploadComplete;
    }
    if (msg.type === "error" && typeof msg.message === "string") {
      errMsg = msg.message;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const part of lines) {
      handleLine(part);
    }
  }
  handleLine(buffer);

  if (errMsg) {
    return { ok: false, message: errMsg };
  }
  if (complete) {
    return {
      ok: true,
      file_id: complete.file_id,
      chunks: complete.chunks,
      truncated: complete.truncated,
      max_chunks: complete.max_chunks,
      estimated_input_tokens_approx: complete.estimated_input_tokens_approx,
    };
  }
  return { ok: false, message: "Unerwartete Antwort vom Server" };
}
