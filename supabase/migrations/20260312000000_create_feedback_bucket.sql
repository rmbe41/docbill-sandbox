-- Create feedback bucket for RLHF data (JSONL files)
-- Edge Function uses service role (bypasses RLS) to write
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feedback',
  'feedback',
  false,
  52428800,
  ARRAY['application/json', 'application/x-ndjson']
)
ON CONFLICT (id) DO NOTHING;
