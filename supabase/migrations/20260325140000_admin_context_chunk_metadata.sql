-- PDF-Ingest / Hybrid RAG: Chunk-Metadaten, Volltext-Vorbereitung, RPC filter_ziffern

ALTER TABLE public.admin_context_chunks
  ADD COLUMN IF NOT EXISTS source_page INT,
  ADD COLUMN IF NOT EXISTS section_path TEXT,
  ADD COLUMN IF NOT EXISTS ziffern TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.admin_context_chunks
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS admin_context_chunks_ziffern_gin
  ON public.admin_context_chunks USING GIN (ziffern);

CREATE INDEX IF NOT EXISTS admin_context_chunks_content_tsv_gin
  ON public.admin_context_chunks USING GIN (content_tsv);

-- Erweiterte Suche (Vektor + optional Ziffer-Filter)
DROP FUNCTION IF EXISTS public.match_admin_context_chunks(extensions.vector, integer, double precision);

CREATE OR REPLACE FUNCTION public.match_admin_context_chunks(
  query_embedding extensions.vector(1536),
  match_count int DEFAULT 8,
  match_threshold float DEFAULT 0.5,
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
  FROM public.admin_context_chunks c
  WHERE
    (1 - (c.embedding <=> query_embedding)) > match_threshold
    AND (
      filter_ziffern IS NULL
      OR cardinality(filter_ziffern) = 0
      OR coalesce(cardinality(c.ziffern), 0) = 0
      OR c.ziffern && filter_ziffern
    )
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Optional: GOÄ JSON in DB (Snapshot; Befüllung per App-Script, nicht in dieser Migration)
CREATE TABLE IF NOT EXISTS public.goae_catalog_snapshot (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  catalog_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.goae_catalog_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read goae catalog snapshot"
  ON public.goae_catalog_snapshot FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only admins can write goae catalog snapshot"
  ON public.goae_catalog_snapshot FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMENT ON TABLE public.goae_catalog_snapshot IS 'Optional: Kopie von goae-catalog-full.json für Runtime-Updates; Edge nutzt weiterhin gebündelte JSON-Datei.';

-- Ingest-Metriken (Admin, Monitoring)
CREATE TABLE IF NOT EXISTS public.ingest_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  chunks_created INT,
  estimated_chunks INT,
  estimated_input_tokens INT,
  truncated BOOLEAN NOT NULL DEFAULT false,
  truncation_reason TEXT,
  error TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

ALTER TABLE public.ingest_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins read ingest_jobs"
  ON public.ingest_jobs FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Only admins insert ingest_jobs"
  ON public.ingest_jobs FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Only admins update ingest_jobs"
  ON public.ingest_jobs FOR UPDATE
  TO authenticated
  USING (public.is_admin());
