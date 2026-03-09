-- Promote latest signed-in user to admin
-- Useful for initial bootstrap when no admin exists yet.

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'
FROM auth.users u
ORDER BY u.last_sign_in_at DESC NULLS LAST, u.created_at DESC
LIMIT 1
ON CONFLICT (user_id) DO UPDATE
SET role = EXCLUDED.role;
