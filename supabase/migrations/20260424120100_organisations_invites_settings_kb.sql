-- Paket A/B: org settings, Einladungen; Paket D/E: KB-Crawl- und Beschluss-Review-Grundstruktur (Spec 7.2 / 7.3)

-- 1) organisations.settings (Spec 13.1 Stub)
ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE POLICY "organisations_update_admin"
  ON public.organisations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = organisations.id
        AND m.user_id = auth.uid()
        AND m.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = organisations.id
        AND m.user_id = auth.uid()
        AND m.role = 'admin'
    )
  );

-- 2) organisation_invites
CREATE TABLE public.organisation_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('admin', 'manager', 'viewer')),
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

CREATE INDEX organisation_invites_org_idx ON public.organisation_invites (organisation_id);
CREATE UNIQUE INDEX organisation_invites_pending_email_idx
  ON public.organisation_invites (organisation_id, lower(email))
  WHERE accepted_at IS NULL;

ALTER TABLE public.organisation_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organisation_invites_select_org"
  ON public.organisation_invites FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = organisation_invites.organisation_id
        AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "organisation_invites_insert_admin"
  ON public.organisation_invites FOR INSERT
  TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = organisation_invites.organisation_id
        AND m.user_id = auth.uid()
        AND m.role = 'admin'
    )
  );

CREATE POLICY "organisation_invites_update_admin"
  ON public.organisation_invites FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = organisation_invites.organisation_id
        AND m.user_id = auth.uid()
        AND m.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = organisation_invites.organisation_id
        AND m.user_id = auth.uid()
        AND m.role = 'admin'
    )
  );

CREATE POLICY "organisation_invites_delete_admin"
  ON public.organisation_invites FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organisation_members m
      WHERE m.organisation_id = organisation_invites.organisation_id
        AND m.user_id = auth.uid()
        AND m.role = 'admin'
    )
  );

-- 3) Verzeichnis: Mitglieder derselben Organisation (E-Mail)
CREATE OR REPLACE FUNCTION public.list_organisation_member_directory()
RETURNS TABLE (user_id uuid, role text, email text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  oid uuid;
BEGIN
  SELECT m.organisation_id INTO oid
  FROM public.organisation_members m
  WHERE m.user_id = auth.uid()
  LIMIT 1;
  IF oid IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT m.user_id, m.role::text, u.email::text, m.created_at
  FROM public.organisation_members m
  INNER JOIN auth.users u ON u.id = m.user_id
  WHERE m.organisation_id = oid;
END;
$$;

REVOKE ALL ON FUNCTION public.list_organisation_member_directory() FROM public;
GRANT EXECUTE ON FUNCTION public.list_organisation_member_directory() TO authenticated;

-- 4) Einladung annehmen (eine org pro User)
CREATE OR REPLACE FUNCTION public.accept_organisation_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.organisation_invites%ROWTYPE;
  uid uuid := auth.uid();
  old_org uuid;
  member_n int;
  uemail text;
  sole_member boolean;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  SELECT * INTO inv
  FROM public.organisation_invites
  WHERE token = p_token
    AND accepted_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_or_expired');
  END IF;

  SELECT email::text INTO uemail FROM auth.users WHERE id = uid;
  IF lower(btrim(COALESCE(uemail, ''))) != lower(btrim(COALESCE(inv.email, ''))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_mismatch');
  END IF;

  SELECT organisation_id INTO old_org
  FROM public.organisation_members
  WHERE user_id = uid
  LIMIT 1;

  IF old_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_membership');
  END IF;

  IF old_org = inv.organisation_id THEN
    UPDATE public.organisation_invites
    SET accepted_at = now()
    WHERE id = inv.id;
    RETURN jsonb_build_object('ok', true, 'message', 'already_in_org');
  END IF;

  SELECT COUNT(*)::int INTO member_n
  FROM public.organisation_members
  WHERE organisation_id = old_org;

  sole_member := (member_n = 1);
  IF sole_member AND (
    EXISTS (SELECT 1 FROM public.batches b WHERE b.organisation_id = old_org)
    OR EXISTS (SELECT 1 FROM public.organisation_kommentar_files f WHERE f.organisation_id = old_org)
    OR EXISTS (SELECT 1 FROM public.organisation_kommentar_chunks c WHERE c.organisation_id = old_org)
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'org_has_data',
      'message', 'Ihre Organisation hat noch Daten (Stapel oder Wissensbasis). Einladung kann so nicht angenommen werden – bitte Support.'
    );
  END IF;

  DELETE FROM public.organisation_members WHERE user_id = uid;

  IF sole_member THEN
    IF NOT EXISTS (SELECT 1 FROM public.organisation_members WHERE organisation_id = old_org) THEN
      DELETE FROM public.organisations WHERE id = old_org;
    END IF;
  END IF;

  INSERT INTO public.organisation_members (organisation_id, user_id, role)
  VALUES (inv.organisation_id, uid, inv.role);

  UPDATE public.organisation_invites
  SET accepted_at = now()
  WHERE id = inv.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_organisation_invite(text) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_organisation_invite(text) TO authenticated;

-- 5) KB Crawl (Spec 7.2) — nur service_role / Hintergrundjobs, keine RLS für authenticated
CREATE TABLE public.kb_crawl_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL DEFAULT 'baek_bv',
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'ok', 'error')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error_message text,
  document_count int NOT NULL DEFAULT 0,
  log jsonb
);

CREATE TABLE public.kb_crawl_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.kb_crawl_runs (id) ON DELETE CASCADE,
  source_url text NOT NULL,
  content_hash text,
  text_extract text,
  byte_length int
);

CREATE INDEX kb_crawl_documents_run_idx ON public.kb_crawl_documents (run_id);
ALTER TABLE public.kb_crawl_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_crawl_documents ENABLE ROW LEVEL SECURITY;

-- Keine Policies: nur Service Role; authenticated hat keinen Zugriff

-- 6) Beschluss manuelle Prüfung (Spec 7.3) — sichtbar für org-admins: nutzt globale Tabelle, Zugriff über App-Rolle
CREATE TABLE public.kb_beschluesse_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_key text,
  titel text,
  quelle text,
  relevanz_payload jsonb,
  aktion text NOT NULL DEFAULT 'manual_review' CHECK (aktion IN ('auto_import', 'manual_review', 'skip')),
  run_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid,
  decision text CHECK (decision IS NULL OR decision IN ('approved', 'rejected'))
);

CREATE INDEX kb_beschluesse_review_pending_idx
  ON public.kb_beschluesse_review (created_at DESC)
  WHERE decision IS NULL;

ALTER TABLE public.kb_beschluesse_review ENABLE ROW LEVEL SECURITY;

-- Product admin (user_roles) sieht und entscheidet
CREATE POLICY "kb_beschluesse_review_all_global_admin"
  ON public.kb_beschluesse_review FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = auth.uid() AND r.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = auth.uid() AND r.role = 'admin'
    )
  );

-- 7) Wöchentlicher Relevanz-Report (Spec 7.3, aggregiert)
CREATE TABLE public.kb_relevanz_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.kb_relevanz_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kb_relevanz_reports_global_admin"
  ON public.kb_relevanz_reports FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = auth.uid() AND r.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = auth.uid() AND r.role = 'admin'
    )
  );
