-- DocBill: persistente Job-Uploads (Hintergrund-Jobs + Batch-Quellen) und Worker-Claim
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'job-uploads',
  'job-uploads',
  false,
  104857600,
  ARRAY[
    'application/pdf',
    'application/octet-stream',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "job_uploads_select_own" ON storage.objects;
DROP POLICY IF EXISTS "job_uploads_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "job_uploads_update_own" ON storage.objects;
DROP POLICY IF EXISTS "job_uploads_delete_own" ON storage.objects;

-- Pfad: {auth.uid()}/... — erste Pfadkomponente muss User-ID sein
CREATE POLICY "job_uploads_select_own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'job-uploads' AND split_part(name, '/', 1) = auth.uid()::text);

CREATE POLICY "job_uploads_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'job-uploads' AND split_part(name, '/', 1) = auth.uid()::text);

CREATE POLICY "job_uploads_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'job-uploads' AND split_part(name, '/', 1) = auth.uid()::text);

CREATE POLICY "job_uploads_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'job-uploads' AND split_part(name, '/', 1) = auth.uid()::text);

-- Global claim für Server-Worker (nur service_role)
CREATE OR REPLACE FUNCTION public.claim_next_background_job_for_worker()
RETURNS SETOF public.background_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH c AS (
    SELECT id
    FROM public.background_jobs
    WHERE status = 'queued'
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.background_jobs j
  SET status = 'running', started_at = now()
  FROM c
  WHERE j.id = c.id
  RETURNING j.*;
$$;

REVOKE ALL ON FUNCTION public.claim_next_background_job_for_worker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_background_job_for_worker() TO service_role;
