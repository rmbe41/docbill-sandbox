-- Spec 03 UI/UX: Batch-Speicherung (dauerhaft, pro Nutzer)

CREATE TABLE public.batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  rechnungen_count integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('processing', 'complete', 'partial')),
  zusammenfassung jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.batch_rechnungen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.batches (id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  patient_id_label text NOT NULL,
  betrag_euro numeric NOT NULL DEFAULT 0,
  liste_status text NOT NULL CHECK (liste_status IN ('geprueft', 'mit_hinweisen', 'fehler', 'offen')),
  hinweise_kurz text,
  fachbereich text,
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX batch_rechnungen_batch_id_idx ON public.batch_rechnungen (batch_id);
CREATE INDEX batches_user_id_idx ON public.batches (user_id);
CREATE INDEX batches_updated_at_idx ON public.batches (updated_at DESC);

ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_rechnungen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "batches_select_own" ON public.batches FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "batches_insert_own" ON public.batches FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "batches_update_own" ON public.batches FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "batches_delete_own" ON public.batches FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "batch_rechnungen_all_own_batch" ON public.batch_rechnungen FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.batches b WHERE b.id = batch_id AND b.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.batches b WHERE b.id = batch_id AND b.user_id = auth.uid())
  );
