import { loadFilesFromStorageRefs, type StorageFileRef } from "./storage-job-files.ts";

export type WorkerHydrateOk = { ok: true; jobUserId: string; jobId: string };
export type WorkerHydrateResult = WorkerHydrateOk | { ok: false };

/**
 * Interner Aufruf (x-docbill-worker-secret): lädt Job + Messages + Dateien aus Storage in den Request-Body.
 */
export async function tryHydrateWorkerBackgroundJob(
  req: Request,
  body: Record<string, unknown>,
): Promise<WorkerHydrateResult> {
  const secret = req.headers.get("x-docbill-worker-secret");
  const expected = Deno.env.get("DOCBILL_WORKER_SECRET");
  const jobId = typeof body.background_job_id === "string" ? body.background_job_id.trim() : "";
  if (!secret || !expected || secret !== expected || !jobId) {
    return { ok: false };
  }

  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !svc) return { ok: false };

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const admin = createClient(url, svc);

  const { data: job, error: jobErr } = await admin.from("background_jobs").select("*").eq("id", jobId).maybeSingle();
  if (jobErr || !job || job.status !== "running") {
    return { ok: false };
  }

  const payload = job.payload as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") return { ok: false };

  const refs = payload.storage_refs as StorageFileRef[] | undefined;
  const exec = payload.execution as Record<string, unknown> | undefined;
  if (!refs?.length || !exec || typeof exec !== "object") {
    return { ok: false };
  }

  let files: { name: string; type: string; data: string }[];
  try {
    files = await loadFilesFromStorageRefs(url, svc, refs, `${job.user_id as string}/`);
  } catch {
    return { ok: false };
  }

  const { data: msgRows, error: mErr } = await admin
    .from("messages")
    .select("role, content")
    .eq("conversation_id", job.conversation_id as string)
    .order("created_at", { ascending: true });

  if (mErr || !msgRows?.length) {
    return { ok: false };
  }

  body.messages = (msgRows as { role: string; content: string }[]).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  body.files = files;
  if (typeof exec.model === "string" && exec.model.trim()) body.model = exec.model.trim();
  if (typeof exec.engine_type === "string" && exec.engine_type.trim()) {
    body.engine_type = exec.engine_type.trim();
  }
  if (typeof exec.extra_rules === "string") body.extra_rules = exec.extra_rules;
  if (exec.kurzantworten === true) body.kurzantworten = true;
  if (exec.kontext_wissen === false) body.kontext_wissen = false;
  if (typeof exec.pseudonym_session_id === "string" && exec.pseudonym_session_id.trim()) {
    body.pseudonym_session_id = exec.pseudonym_session_id.trim();
  }
  if (exec.regelwerk === "EBM" || exec.regelwerk === "GOAE") body.regelwerk = exec.regelwerk;
  if (exec.mode === "A" || exec.mode === "B" || exec.mode === "C") body.mode = exec.mode;
  const e3cg = payload.engine3CaseGroups;
  if (Array.isArray(e3cg)) {
    body.engine3_case_groups = e3cg;
  }

  delete body.storage_file_refs;
  delete body.background_job_id;

  return { ok: true, jobUserId: job.user_id as string, jobId: job.id as string };
}
