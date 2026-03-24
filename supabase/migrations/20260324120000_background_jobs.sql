-- Background job queue for parallel / queued DocBill tasks (per conversation)
CREATE TABLE public.background_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  progress_label TEXT,
  progress_step INTEGER,
  progress_total INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX background_jobs_user_status_sort_idx
  ON public.background_jobs (user_id, status, sort_order, created_at);

CREATE INDEX background_jobs_conversation_id_idx ON public.background_jobs (conversation_id);

ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own background_jobs"
  ON public.background_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own background_jobs"
  ON public.background_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own background_jobs"
  ON public.background_jobs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own background_jobs"
  ON public.background_jobs FOR DELETE
  USING (auth.uid() = user_id);

-- Phase 3 (optional): a worker Edge Function can poll `queued` jobs and call goae-chat with stored payloads
-- (requires persisting file blobs in Storage, not only in-browser maps).
