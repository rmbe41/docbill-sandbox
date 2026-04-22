-- Spec 05 §7.4: lizenzierte GOÄ-Kommentarliteratur pro Organisation, Chunking + Vektor
-- organisation_id: Mandant; in der aktuellen App-Zuordnung = auth.uid() (vgl. Batches)

CREATE TABLE public.organisation_kommentar_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  quelle text NOT NULL CHECK (quelle IN ('brueck', 'hoffmann', 'lang_schaefer')),
  filename text NOT NULL,
  content_text text NOT NULL,
  storage_path text,
  uploaded_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, quelle)
);

CREATE TABLE public.organisation_kommentar_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  file_id uuid NOT NULL REFERENCES public.organisation_kommentar_files (id) ON DELETE CASCADE,
  filename text NOT NULL,
  chunk_index int NOT NULL,
  content text NOT NULL,
  embedding extensions.vector(1536),
  ziffern text[] NOT NULL DEFAULT '{}',
  source_page int,
  section_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX organisation_kommentar_chunks_file_id_idx ON public.organisation_kommentar_chunks (file_id);
CREATE INDEX organisation_kommentar_chunks_org_id_idx ON public.organisation_kommentar_chunks (organisation_id);
CREATE INDEX organisation_kommentar_chunks_ziffern_gin
  ON public.organisation_kommentar_chunks USING GIN (ziffern);

CREATE INDEX organisation_kommentar_files_org_id_idx ON public.organisation_kommentar_files (organisation_id);

ALTER TABLE public.organisation_kommentar_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_kommentar_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_kommentar_files_select_own_org"
  ON public.organisation_kommentar_files FOR SELECT
  TO authenticated
  USING (organisation_id = auth.uid());

CREATE POLICY "org_kommentar_files_insert_own_org"
  ON public.organisation_kommentar_files FOR INSERT
  TO authenticated
  WITH CHECK (organisation_id = auth.uid() AND uploaded_by = auth.uid());

CREATE POLICY "org_kommentar_files_update_own_org"
  ON public.organisation_kommentar_files FOR UPDATE
  TO authenticated
  USING (organisation_id = auth.uid())
  WITH CHECK (organisation_id = auth.uid() AND uploaded_by = auth.uid());

CREATE POLICY "org_kommentar_files_delete_own_org"
  ON public.organisation_kommentar_files FOR DELETE
  TO authenticated
  USING (organisation_id = auth.uid());

CREATE POLICY "org_kommentar_chunks_select_own_org"
  ON public.organisation_kommentar_chunks FOR SELECT
  TO authenticated
  USING (organisation_id = auth.uid());

-- RPC: nur für Aufrufer mit Service Key (goae-chat Edge)
CREATE OR REPLACE FUNCTION public.match_organisation_kommentar_chunks(
  p_organisation_id uuid,
  query_embedding extensions.vector(1536),
  match_count int DEFAULT 6,
  match_threshold float DEFAULT 0.48,
  filter_ziffern text[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  filename text,
  chunk_index int,
  content text,
  similarity float,
  source_page int,
  section_path text,
  ziffern text[]
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    c.id,
    c.filename,
    c.chunk_index,
    c.content,
    (1 - (c.embedding <=> query_embedding))::float AS similarity,
    c.source_page,
    c.section_path,
    c.ziffern
  FROM public.organisation_kommentar_chunks c
  WHERE
    c.organisation_id = p_organisation_id
    AND c.embedding IS NOT NULL
    AND (1 - (c.embedding <=> query_embedding)) > match_threshold
    AND (
      filter_ziffern IS NULL
      OR cardinality(filter_ziffern) = 0
      OR coalesce(cardinality(c.ziffern), 0) = 0
      OR c.ziffern && filter_ziffern
    )
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.match_organisation_kommentar_chunks(
  uuid, extensions.vector(1536), int, float, text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_organisation_kommentar_chunks(
  uuid, extensions.vector(1536), int, float, text[]
) TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-kommentar',
  'org-kommentar',
  false,
  52428800,
  ARRAY['application/pdf', 'text/plain', 'text/markdown', 'text/csv']::text[]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "org_kommentar_storage_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'org-kommentar' AND split_part(name, '/', 1) = auth.uid()::text);

CREATE POLICY "org_kommentar_storage_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'org-kommentar' AND split_part(name, '/', 1) = auth.uid()::text);

CREATE POLICY "org_kommentar_storage_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'org-kommentar' AND split_part(name, '/', 1) = auth.uid()::text);
