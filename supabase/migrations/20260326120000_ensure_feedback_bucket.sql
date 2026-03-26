-- Ensure feedback bucket exists if an earlier migration was skipped on the remote project.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT
  'feedback',
  'feedback',
  false,
  52428800,
  ARRAY['application/json', 'application/x-ndjson']::text[]
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'feedback');
