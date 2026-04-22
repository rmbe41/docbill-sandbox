import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";
import {
  drainGoaeSseToState,
  type WorkerSseState,
  workerAssistantHasUserVisibleError,
  workerStateHasDeliverable,
} from "./sse-drain.ts";

const JOB_BUCKET = "job-uploads";

function buildStructuredContent(state: WorkerSseState) {
  if (
    state.invoiceData == null &&
    state.serviceBillingData == null &&
    state.engine3Data == null &&
    (state.engine3Cases == null || state.engine3Cases.length === 0) &&
    state.engine3SegmentationProposal == null &&
    state.frageStructured == null &&
    state.docbillAnalyse == null
  ) {
    return null;
  }
  return {
    v: 1,
    invoiceResult: state.invoiceData,
    serviceBillingResult: state.serviceBillingData,
    engine3Result: state.engine3Data,
    engine3Cases: state.engine3Cases,
    engine3SegmentationProposal: state.engine3SegmentationProposal,
    frageAnswer: state.frageStructured,
    docbillAnalyse: state.docbillAnalyse,
  };
}

function frageStructuredToMarkdown(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const o = raw as Record<string, unknown>;
  const kurz = typeof o.kurzantwort === "string" ? o.kurzantwort.trim() : "";
  const detail = typeof o.detail === "string" ? o.detail.trim() : "";
  return [kurz, detail].filter(Boolean).join("\n\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  const cronSecret = Deno.env.get("DOCBILL_CRON_SECRET");
  const auth = req.headers.get("Authorization");
  const headerSecret = req.headers.get("x-docbill-cron-secret");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!cronSecret || (bearer !== cronSecret && headerSecret !== cronSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const workerSecret = Deno.env.get("DOCBILL_WORKER_SECRET");
  if (!supabaseUrl || !serviceKey || !workerSecret) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: claimed, error: claimErr } = await admin.rpc("claim_next_background_job_for_worker");
  if (claimErr) {
    console.error("claim_next_background_job_for_worker", claimErr);
    return new Response(JSON.stringify({ error: claimErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = claimed as unknown[] | null;
  if (!rows?.length) {
    return new Response(JSON.stringify({ ok: true, claimed: false }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const job = rows[0] as {
    id: string;
    conversation_id: string;
    payload: Record<string, unknown>;
  };

  const chatUrl = `${supabaseUrl}/functions/v1/goae-chat`;
  let chatResp: Response;
  try {
    chatResp = await fetch(chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-docbill-worker-secret": workerSecret,
      },
      body: JSON.stringify({ background_job_id: job.id }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("background_jobs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: `goae-chat Aufruf fehlgeschlagen: ${msg}`,
      })
      .eq("id", job.id);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!chatResp.ok || !chatResp.body) {
    const t = await chatResp.text();
    await admin
      .from("background_jobs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: `goae-chat ${chatResp.status}: ${t.slice(0, 500)}`,
      })
      .eq("id", job.id);
    return new Response(JSON.stringify({ ok: false, claimed: true, jobId: job.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const reader = chatResp.body.getReader();
  const state = await drainGoaeSseToState(reader);
  const deliverable = workerStateHasDeliverable(state);
  const sseFail = state.hadSseError || workerAssistantHasUserVisibleError(state.assistantContent) || !deliverable;

  let content =
    state.assistantContent.trim() ||
    frageStructuredToMarkdown(state.frageStructured) ||
    (state.engine3Cases?.length ? "[DocBill: Engine 3 – mehrere Vorgänge]" : "") ||
    (state.engine3Data ? "[DocBill: Engine 3 – strukturiertes Ergebnis]" : "") ||
    (state.engine3SegmentationProposal ? "[DocBill: Engine 3 – Zuordnung offen]" : "") ||
    (state.docbillAnalyse ? "[DocBill: Pflichtanalyse]" : "");

  if (!content && !deliverable) {
    content = "";
  }

  const structured = buildStructuredContent(state);

  const { error: insErr } = await admin.from("messages").insert({
    conversation_id: job.conversation_id,
    role: "assistant",
    content: content || "—",
    ...(structured ? { structured_content: structured } : {}),
  });

  if (insErr) {
    console.error("worker insert message", insErr);
    await admin
      .from("background_jobs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: "Antwort konnte nicht gespeichert werden.",
      })
      .eq("id", job.id);
    return new Response(JSON.stringify({ ok: false, jobId: job.id, error: insErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const refs = job.payload?.storage_refs as { path: string }[] | undefined;
  if (Array.isArray(refs) && refs.length > 0 && !sseFail) {
    const paths = refs.map((r) => r.path).filter((p) => typeof p === "string");
    if (paths.length) {
      await admin.storage.from(JOB_BUCKET).remove(paths);
    }
  }

  const preview = content.trim().slice(0, 160) || (deliverable ? "Abgeschlossen" : "");
  await admin
    .from("background_jobs")
    .update({
      status: sseFail ? "failed" : "completed",
      finished_at: new Date().toISOString(),
      error: sseFail
        ? state.hadSseError
          ? "Pipeline- oder Stream-Fehler"
          : !deliverable
            ? "Keine Antwort erhalten."
            : "Fehler in der Antwort."
        : null,
      progress_label: null,
      progress_step: null,
      progress_total: null,
      payload: {
        ...(typeof job.payload === "object" && job.payload ? job.payload : {}),
        assistantPreview: preview,
      },
    })
    .eq("id", job.id);

  return new Response(JSON.stringify({ ok: true, claimed: true, jobId: job.id, failed: sseFail }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
