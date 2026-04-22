-- Spec 08 §13.1, §13.4: sso_config, Nutzer-Metadaten in organisation_members, Sessions organisationsgebunden

-- 1) Organisation: SSO-Metadaten (keine Secrets – Spec 13.1)
ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS sso_config jsonb;

COMMENT ON COLUMN public.organisations.sso_config IS
  'Spec 13.1: options provider/issuer/clientId; secrets in Vault, nicht in DB.';

-- 2) Spec 13.1 User (Teil): fachgebiet, isActive pro Mandant
ALTER TABLE public.organisation_members
  ADD COLUMN IF NOT EXISTS fachgebiet text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 3) conversations.organisation_id (Spec 13.4: Sessions organisationsgebunden)
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS organisation_id uuid REFERENCES public.organisations (id) ON DELETE RESTRICT;

UPDATE public.conversations c
SET organisation_id = m.organisation_id
FROM public.organisation_members m
WHERE c.organisation_id IS NULL
  AND m.user_id = c.user_id;

-- Edge case: Gespräche ohne organisation_id (z. B. Race mit Trigger)
DO $$
DECLARE
  c record;
  oid uuid;
  new_oid uuid;
  base_name text;
BEGIN
  FOR c IN
    SELECT id, user_id FROM public.conversations WHERE organisation_id IS NULL
  LOOP
    SELECT m.organisation_id INTO oid
    FROM public.organisation_members m
    WHERE m.user_id = c.user_id
    LIMIT 1;
    IF oid IS NOT NULL THEN
      UPDATE public.conversations SET organisation_id = oid WHERE id = c.id;
    ELSE
      new_oid := gen_random_uuid();
      SELECT NULLIF(trim(split_part(u.email::text, '@', 1)), '') INTO base_name
      FROM auth.users u
      WHERE u.id = c.user_id;
      IF base_name IS NULL OR base_name = '' THEN
        base_name := 'Praxis';
      END IF;
      INSERT INTO public.organisations (id, name, settings)
      VALUES (
        new_oid,
        base_name || ' (Migration)',
        jsonb_build_object(
          'defaultRegelwerk', 'GOAE',
          'customWissensbasis', true,
          'datenschutzModus', 'standard'
        )
      );
      INSERT INTO public.organisation_members (organisation_id, user_id, role, is_active)
      VALUES (new_oid, c.user_id, 'admin', true);
      UPDATE public.conversations SET organisation_id = new_oid WHERE id = c.id;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.conversations
  ALTER COLUMN organisation_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS conversations_organisation_id_idx
  ON public.conversations (organisation_id);

-- 4) RLS conversations: Nutzer + Mandant
DROP POLICY IF EXISTS "Users can read own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can insert own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can update own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can delete own conversations" ON public.conversations;

CREATE POLICY "conversations_select_own_org"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organisation_members m
      WHERE m.user_id = auth.uid()
        AND m.organisation_id = conversations.organisation_id
    )
  );

CREATE POLICY "conversations_insert_own_org"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organisation_members m
      WHERE m.user_id = auth.uid()
        AND m.organisation_id = conversations.organisation_id
    )
  );

CREATE POLICY "conversations_update_own_org"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organisation_members m
      WHERE m.user_id = auth.uid()
        AND m.organisation_id = conversations.organisation_id
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organisation_members m
      WHERE m.user_id = auth.uid()
        AND m.organisation_id = conversations.organisation_id
    )
  );

CREATE POLICY "conversations_delete_own_org"
  ON public.conversations FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organisation_members m
      WHERE m.user_id = auth.uid()
        AND m.organisation_id = conversations.organisation_id
    )
  );

-- 5) Neuregistrierung: Default-Settings (Spec 13.1) – ohne fachgebiet-Default in JSON
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
  INSERT INTO public.organisations (id, name, settings)
  VALUES (
    new_org_id,
    base_name || ' (Organisation)',
    jsonb_build_object(
      'defaultRegelwerk', 'GOAE',
      'customWissensbasis', false,
      'datenschutzModus', 'standard'
    )
  );
  INSERT INTO public.organisation_members (organisation_id, user_id, role, is_active)
  VALUES (new_org_id, NEW.id, 'admin', true);
  RETURN NEW;
END;
$$;
