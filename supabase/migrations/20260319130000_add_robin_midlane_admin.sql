-- Promote robin@midlane.com to admin.
-- If the user exists: insert/update user_roles.
-- If not yet: auto-promote on first signup via trigger.

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'
FROM auth.users
WHERE lower(email) = 'robin@midlane.com'
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
