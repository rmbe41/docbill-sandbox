-- Benchmark runs for engine comparison (admin only)

CREATE TABLE IF NOT EXISTS public.benchmark_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  started_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  case_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS public.benchmark_run_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.benchmark_runs(id) ON DELETE CASCADE,
  engine TEXT NOT NULL CHECK (engine IN ('simple', 'complex', 'engine3', 'engine3_1')),
  case_id TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('L1', 'L2', 'L3', 'L4')),
  tags TEXT[] NOT NULL DEFAULT '{}',
  metrics_json JSONB NOT NULL,
  raw_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.benchmark_run_summaries (
  run_id UUID NOT NULL REFERENCES public.benchmark_runs(id) ON DELETE CASCADE,
  engine TEXT NOT NULL CHECK (engine IN ('simple', 'complex', 'engine3', 'engine3_1')),
  total_score NUMERIC NOT NULL,
  rule_f1 NUMERIC NOT NULL,
  correction_score NUMERIC NOT NULL,
  amount_score NUMERIC NOT NULL,
  evidence_score NUMERIC NOT NULL,
  ops_score NUMERIC NOT NULL,
  l1_score NUMERIC NOT NULL,
  l2_score NUMERIC NOT NULL,
  l3_score NUMERIC NOT NULL,
  l4_score NUMERIC NOT NULL,
  PRIMARY KEY (run_id, engine)
);

CREATE INDEX IF NOT EXISTS benchmark_runs_started_at_idx
  ON public.benchmark_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS benchmark_results_run_engine_idx
  ON public.benchmark_run_results (run_id, engine);

ALTER TABLE public.benchmark_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.benchmark_run_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.benchmark_run_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read benchmark runs"
  ON public.benchmark_runs FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can insert benchmark runs"
  ON public.benchmark_runs FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update benchmark runs"
  ON public.benchmark_runs FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can read benchmark results"
  ON public.benchmark_run_results FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can insert benchmark results"
  ON public.benchmark_run_results FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can read benchmark summaries"
  ON public.benchmark_run_summaries FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can insert benchmark summaries"
  ON public.benchmark_run_summaries FOR INSERT
  WITH CHECK (public.is_admin());

CREATE OR REPLACE VIEW public.benchmark_latest_summary AS
SELECT
  r.id AS run_id,
  r.started_at,
  r.finished_at,
  r.status,
  r.case_count,
  s.engine,
  s.total_score,
  s.rule_f1,
  s.correction_score,
  s.amount_score,
  s.evidence_score,
  s.ops_score,
  s.l1_score,
  s.l2_score,
  s.l3_score,
  s.l4_score
FROM public.benchmark_runs r
JOIN public.benchmark_run_summaries s ON s.run_id = r.id
WHERE r.id = (
  SELECT id FROM public.benchmark_runs ORDER BY started_at DESC LIMIT 1
);

