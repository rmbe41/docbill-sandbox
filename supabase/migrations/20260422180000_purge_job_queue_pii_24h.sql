-- Spec 07 §9.1: PII max. 24h in der Verarbeitungsschlange; anschließend löschen/entfallen lassen.
-- Hintergrund-Job-Uploads (keine Batch-Quelle unter .../batch/...), abgelaufene Queue-Jobs, Payload-Reduktion.

CREATE OR REPLACE FUNCTION public.purge_job_queue_pii_24h()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  del_storage int := 0;
  cancelled_stale int := 0;
  cleared_payloads int := 0;
BEGIN
  DELETE FROM storage.objects
  WHERE bucket_id = 'job-uploads'
    AND (name NOT LIKE '%/batch/%')
    AND created_at < now() - interval '24 hours';
  GET DIAGNOSTICS del_storage = ROW_COUNT;

  UPDATE public.background_jobs
  SET
    status = 'cancelled',
    error = 'Abgebrochen: Aufbewahrungsfrist 24h in der Verarbeitungsschlange (Datenminimierung).',
    payload = '{}'::jsonb,
    finished_at = coalesce(finished_at, now())
  WHERE status IN ('queued', 'running')
    AND created_at < now() - interval '24 hours';
  GET DIAGNOSTICS cancelled_stale = ROW_COUNT;

  UPDATE public.background_jobs
  SET payload = '{}'::jsonb
  WHERE status IN ('completed', 'failed', 'cancelled')
    AND coalesce(finished_at, created_at) < now() - interval '24 hours'
    AND payload IS NOT NULL
    AND payload::text NOT IN ('{}', 'null');
  GET DIAGNOSTICS cleared_payloads = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_job_upload_objects', del_storage,
    'cancelled_stale_jobs', cancelled_stale,
    'cleared_job_payloads', cleared_payloads
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_job_queue_pii_24h() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_job_queue_pii_24h() TO service_role;
