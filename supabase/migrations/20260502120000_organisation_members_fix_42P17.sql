-- 42P17 "infinite recursion" on organisation_members: select_same_org subquery re-enters RLS.
-- Client und EXISTS-Checks brauchen nur die eigene Zeile → Policy organisation_members_select_own reicht.
-- Verzeichnis: list_organisation_member_directory (SECURITY DEFINER).

DROP POLICY IF EXISTS "organisation_members_select_same_org" ON public.organisation_members;

-- Falls ein früherer Versuch (Funktion + Policy) schon lief, Funktion entfernen
DROP FUNCTION IF EXISTS public.auth_organisation_ids_for_user();

-- Lese-Mandantenkontext ohne RLS-Loop (Fallback, sobald per Migration deployed)
CREATE OR REPLACE FUNCTION public.get_organisation_context()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('organisation_id', m.organisation_id, 'role', m.role)
  FROM public.organisation_members m
  WHERE m.user_id = auth.uid()
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_organisation_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_organisation_context() TO authenticated;
