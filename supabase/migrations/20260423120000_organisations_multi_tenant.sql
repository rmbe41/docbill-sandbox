-- Spec 08: Eine Organisation, viele Nutzer. Batches + Wissensbasis-Kommentar sind organisationsgebunden.

-- 1) Kern-Tabellen
CREATE TABLE public.organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  typ text NOT NULL DEFAULT 'einzelpraxis'
    CHECK (typ IN ('einzelpraxis', 'gemeinschaftspraxis', 'mvz', 'abrechnungsdienst', 'klinik')),
  plan text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro', 'enterprise')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organisation_members (
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin'
    CHECK (role IN ('admin', 'manager', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, user_id),
  CONSTRAINT organisation_members_one_org_per_user UNIQUE (user_id)
);

CREATE INDEX organisation_members_user_id_idx ON public.organisation_members (user_id);
CREATE INDEX organisation_members_org_id_idx ON public.organisation_members (organisation_id);

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_members ENABLE ROW LEVEL SECURITY;

-- 2) Migrieren: bisher war organisation_id oft = auth.uid() (1:1)
DO $$
DECLARE
  lid uuid;
  new_org_id uuid;
BEGIN
  FOR lid IN
    SELECT DISTINCT organisation_id
    FROM (
      SELECT organisation_id FROM public.batches
      UNION
      SELECT organisation_id FROM public.organisation_kommentar_files
    ) x
  LOOP
    new_org_id := gen_random_uuid();
    INSERT INTO public.organisations (id, name)
    VALUES (new_org_id, 'Praxis (Migration)');
    INSERT INTO public.organisation_members (organisation_id, user_id, role)
    VALUES (new_org_id, lid, 'admin');
    UPDATE public.batches SET organisation_id = new_org_id WHERE organisation_id = lid;
    UPDATE public.organisation_kommentar_files SET organisation_id = new_org_id WHERE organisation_id = lid;
    UPDATE public.organisation_kommentar_chunks SET organisation_id = new_org_id WHERE organisation_id = lid;
  END LOOP;
END $$;

-- 3) Alle auth.users ohne Mitgliedschaft (z. B. nur Chat, keine Batches)
DO $$
DECLARE
  u record;
  new_org_id uuid;
BEGIN
  FOR u IN
    SELECT au.id, au.email
    FROM auth.users au
    WHERE NOT EXISTS (SELECT 1 FROM public.organisation_members m WHERE m.user_id = au.id)
  LOOP
    new_org_id := gen_random_uuid();
    INSERT INTO public.organisations (id, name)
    VALUES (
      new_org_id,
      COALESCE(NULLIF(trim(split_part(u.email, '@', 1)), ''), 'Praxis') || ' (Organisation)'
    );
    INSERT INTO public.organisation_members (organisation_id, user_id, role)
    VALUES (new_org_id, u.id, 'admin');
  END LOOP;
END $$;

-- 4) Fremdschlüssel Batches → organisations
ALTER TABLE public.batches
  ADD CONSTRAINT batches_organisation_id_fkey
  FOREIGN KEY (organisation_id) REFERENCES public.organisations (id) ON DELETE RESTRICT;

-- 5) organisations: lesen nur als Mitglied
CREATE POLICY "organisations_select_member"
  ON public.organisations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = organisations.id AND m.user_id = auth.uid()
    )
  );

-- 6) organisation_members: Mitglieder derselben Org sehen sich
CREATE POLICY "organisation_members_select_same_org"
  ON public.organisation_members FOR SELECT
  TO authenticated
  USING (
    organisation_id IN (
      SELECT m.organisation_id FROM public.organisation_members m WHERE m.user_id = auth.uid()
    )
  );

-- 7) Batches: alte Policies
DROP POLICY IF EXISTS "batches_select_own" ON public.batches;
DROP POLICY IF EXISTS "batches_insert_own" ON public.batches;
DROP POLICY IF EXISTS "batches_update_own" ON public.batches;
DROP POLICY IF EXISTS "batches_delete_own" ON public.batches;

CREATE POLICY "batches_select_org"
  ON public.batches FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = batches.organisation_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "batches_insert_org_write"
  ON public.batches FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = batches.organisation_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "batches_update_org_write"
  ON public.batches FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = batches.organisation_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = batches.organisation_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "batches_delete_org_write"
  ON public.batches FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = batches.organisation_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  );

-- 8) batch_rechnungen
DROP POLICY IF EXISTS "batch_rechnungen_all_own_batch" ON public.batch_rechnungen;

CREATE POLICY "batch_rechnungen_select_org"
  ON public.batch_rechnungen FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.batches b
      INNER JOIN public.organisation_members m ON m.organisation_id = b.organisation_id
      WHERE b.id = batch_rechnungen.batch_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "batch_rechnungen_write_org_managers"
  ON public.batch_rechnungen FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.batches b
      INNER JOIN public.organisation_members m ON m.organisation_id = b.organisation_id
      WHERE b.id = batch_rechnungen.batch_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "batch_rechnungen_update_org_managers"
  ON public.batch_rechnungen FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.batches b
      INNER JOIN public.organisation_members m ON m.organisation_id = b.organisation_id
      WHERE b.id = batch_rechnungen.batch_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.batches b
      INNER JOIN public.organisation_members m ON m.organisation_id = b.organisation_id
      WHERE b.id = batch_rechnungen.batch_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "batch_rechnungen_delete_org_managers"
  ON public.batch_rechnungen FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.batches b
      INNER JOIN public.organisation_members m ON m.organisation_id = b.organisation_id
      WHERE b.id = batch_rechnungen.batch_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  );

-- 9) Kommentarliteratur: Policies ersetzen
DROP POLICY IF EXISTS "org_kommentar_files_select_own_org" ON public.organisation_kommentar_files;
DROP POLICY IF EXISTS "org_kommentar_files_insert_own_org" ON public.organisation_kommentar_files;
DROP POLICY IF EXISTS "org_kommentar_files_update_own_org" ON public.organisation_kommentar_files;
DROP POLICY IF EXISTS "org_kommentar_files_delete_own_org" ON public.organisation_kommentar_files;
DROP POLICY IF EXISTS "org_kommentar_chunks_select_own_org" ON public.organisation_kommentar_chunks;

CREATE POLICY "org_kommentar_files_select_org"
  ON public.organisation_kommentar_files FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = organisation_kommentar_files.organisation_id
        AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "org_kommentar_files_insert_write"
  ON public.organisation_kommentar_files FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = organisation_kommentar_files.organisation_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "org_kommentar_files_update_write"
  ON public.organisation_kommentar_files FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = organisation_kommentar_files.organisation_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = organisation_kommentar_files.organisation_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "org_kommentar_files_delete_write"
  ON public.organisation_kommentar_files FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = organisation_kommentar_files.organisation_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "org_kommentar_chunks_select_org"
  ON public.organisation_kommentar_chunks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = organisation_kommentar_chunks.organisation_id
        AND m.user_id = auth.uid()
    )
  );

-- 10) Storage: Pfad = organisations_id/… (und Legacy user_id/… für alte Dateien)
DROP POLICY IF EXISTS "org_kommentar_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "org_kommentar_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "org_kommentar_storage_delete" ON storage.objects;

CREATE POLICY "org_kommentar_storage_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'org-kommentar'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR split_part(name, '/', 1) IN (
        SELECT m.organisation_id::text FROM public.organisation_members m WHERE m.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "org_kommentar_storage_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'org-kommentar'
    AND split_part(name, '/', 1) IN (
      SELECT m.organisation_id::text FROM public.organisation_members m
      WHERE m.user_id = auth.uid() AND m.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "org_kommentar_storage_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'org-kommentar'
    AND split_part(name, '/', 1) IN (
      SELECT m.organisation_id::text FROM public.organisation_members m
      WHERE m.user_id = auth.uid() AND m.role IN ('admin', 'manager')
    )
  );

-- 11) Neuer User: eine Organisation anlegen
CREATE OR REPLACE FUNCTION public.handle_new_user_organisation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
  base_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.organisation_members WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  new_org_id := gen_random_uuid();
  base_name := NULLIF(trim(split_part(NEW.email, '@', 1)), '');
  IF base_name IS NULL OR base_name = '' THEN
    base_name := 'Praxis';
  END IF;
  INSERT INTO public.organisations (id, name)
  VALUES (new_org_id, base_name || ' (Organisation)');
  INSERT INTO public.organisation_members (organisation_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'admin');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_organisation ON auth.users;
CREATE TRIGGER on_auth_user_created_organisation
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_user_organisation();
