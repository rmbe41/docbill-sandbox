-- Ensure product admins (public.user_roles) for known emails.
-- Idempotent: safe to re-run; updates existing rows.

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'
FROM auth.users
WHERE lower(email) IN ('robinmiguelbetz@gmail.com', 'robin@midlane.com')
ON CONFLICT (user_id) DO UPDATE
SET role = EXCLUDED.role;

CREATE OR REPLACE FUNCTION public.grant_admin_for_known_emails()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(NEW.email) IN ('robinmiguelbetz@gmail.com', 'robin@midlane.com') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grant_admin_for_known_emails ON auth.users;
CREATE TRIGGER trg_grant_admin_for_known_emails
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.grant_admin_for_known_emails();
