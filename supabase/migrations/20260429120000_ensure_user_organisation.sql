-- Konto hat keine organisation_members-Zeile (z. B. lokal, älterer Stand, manuell gelöscht).
-- Wie der Trigger handle_new_user_organisation, aber on-demand: idempotent, nur für auth.uid().

CREATE OR REPLACE FUNCTION public.ensure_user_organisation()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  result_id uuid;
  new_org_id uuid;
  base_name text;
  user_email text;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = 'P0001';
  END IF;

  SELECT m.organisation_id
  INTO result_id
  FROM public.organisation_members m
  WHERE m.user_id = uid
  LIMIT 1;

  IF result_id IS NOT NULL THEN
    RETURN result_id;
  END IF;

  new_org_id := gen_random_uuid();
  SELECT u.email::text INTO user_email FROM auth.users u WHERE u.id = uid;
  base_name := NULLIF(trim(split_part(COALESCE(user_email, ''), '@', 1)), '');
  IF base_name IS NULL OR base_name = '' THEN
    base_name := 'Praxis';
  END IF;

  BEGIN
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
    VALUES (new_org_id, uid, 'admin', true);
  EXCEPTION
    WHEN unique_violation THEN
      NULL; -- paralleles ensure/trigger: Zeile existiert, unten erneut lesen
  END;

  SELECT m.organisation_id
  INTO result_id
  FROM public.organisation_members m
  WHERE m.user_id = uid
  LIMIT 1;

  IF result_id IS NULL THEN
    RAISE EXCEPTION 'ensure_user_organisation_failed' USING errcode = 'P0001';
  END IF;

  RETURN result_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user_organisation() FROM public;
GRANT EXECUTE ON FUNCTION public.ensure_user_organisation() TO authenticated;
