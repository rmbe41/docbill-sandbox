-- Admin Context RAG: pgvector, chunks table, similarity search
-- Enables retrieval-based admin context instead of full-text loading

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE public.admin_context_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES public.admin_context_files(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding extensions.vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW index optional: requires pgvector 0.5+ with vector_cosine_ops
-- CREATE INDEX admin_context_chunks_embedding_idx ON public.admin_context_chunks
--   USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

ALTER TABLE public.admin_context_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read context chunks"
  ON public.admin_context_chunks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only admins can insert context chunks"
  ON public.admin_context_chunks FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Only admins can delete context chunks"
  ON public.admin_context_chunks FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- RPC for similarity search (called from Edge Functions with service role)
CREATE OR REPLACE FUNCTION public.match_admin_context_chunks(
  query_embedding extensions.vector(1536),
  match_count int DEFAULT 8,
  match_threshold float DEFAULT 0.5
)
RETURNS TABLE (
  id uuid,
  filename text,
  chunk_index int,
  content text,
  similarity float
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    admin_context_chunks.id,
    admin_context_chunks.filename,
    admin_context_chunks.chunk_index,
    admin_context_chunks.content,
    1 - (admin_context_chunks.embedding <=> query_embedding) AS similarity
  FROM public.admin_context_chunks
  WHERE 1 - (admin_context_chunks.embedding <=> query_embedding) > match_threshold
  ORDER BY admin_context_chunks.embedding <=> query_embedding
  LIMIT match_count;
$$;
