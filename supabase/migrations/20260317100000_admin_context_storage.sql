-- Admin context storage bucket for PDF preview
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'admin-context',
  'admin-context',
  false,
  52428800,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to read (for preview)
CREATE POLICY "Authenticated users can read admin context files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'admin-context');

-- Only admins can upload
CREATE POLICY "Admins can upload admin context files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'admin-context'
    AND public.is_admin()
  );

-- Only admins can delete
CREATE POLICY "Admins can delete admin context files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'admin-context'
    AND public.is_admin()
  );

-- Add storage_path column for PDF preview
ALTER TABLE public.admin_context_files
  ADD COLUMN IF NOT EXISTS storage_path TEXT;
