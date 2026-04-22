-- Fälle (Cases): mehrere Unterlagen (batch_rechnungen) pro Patientenkontext

CREATE TABLE public.batch_faelle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.batches (id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX batch_faelle_batch_id_idx ON public.batch_faelle (batch_id);

ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS faelle_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.batch_rechnungen
  ADD COLUMN IF NOT EXISTS fall_id uuid;

-- Bestehende Zeilen: je eine Fall-Zeile pro Unterlage
INSERT INTO public.batch_faelle (batch_id, sort_order, label)
SELECT br.batch_id, br.sort_order, br.patient_id_label
FROM public.batch_rechnungen br;

UPDATE public.batch_rechnungen br
SET fall_id = bf.id
FROM public.batch_faelle bf
WHERE bf.batch_id = br.batch_id
  AND bf.sort_order = br.sort_order
  AND br.fall_id IS NULL;

ALTER TABLE public.batch_rechnungen
  ALTER COLUMN fall_id SET NOT NULL;

ALTER TABLE public.batch_rechnungen
  ADD CONSTRAINT batch_rechnungen_fall_id_fkey
  FOREIGN KEY (fall_id) REFERENCES public.batch_faelle (id) ON DELETE RESTRICT;

UPDATE public.batches b
SET faelle_count = (SELECT count(*)::integer FROM public.batch_faelle f WHERE f.batch_id = b.id);

ALTER TABLE public.batch_faelle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "batch_faelle_select_org"
  ON public.batch_faelle FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.batches b
      INNER JOIN public.organisation_members m ON m.organisation_id = b.organisation_id
      WHERE b.id = batch_faelle.batch_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "batch_faelle_insert_org_managers"
  ON public.batch_faelle FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.batches b
      INNER JOIN public.organisation_members m ON m.organisation_id = b.organisation_id
      WHERE b.id = batch_faelle.batch_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "batch_faelle_update_org_managers"
  ON public.batch_faelle FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.batches b
      INNER JOIN public.organisation_members m ON m.organisation_id = b.organisation_id
      WHERE b.id = batch_faelle.batch_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.batches b
      INNER JOIN public.organisation_members m ON m.organisation_id = b.organisation_id
      WHERE b.id = batch_faelle.batch_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "batch_faelle_delete_org_managers"
  ON public.batch_faelle FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.batches b
      INNER JOIN public.organisation_members m ON m.organisation_id = b.organisation_id
      WHERE b.id = batch_faelle.batch_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  );

COMMENT ON TABLE public.batch_faelle IS 'Abrechnungsfall im Stapel; gruppiert mehrere batch_rechnungen (Unterlagen)';
COMMENT ON COLUMN public.batches.faelle_count IS 'Anzahl Fälle (batch_faelle); rechnungen_count = Unterlagen';
