-- User preference: short structured answers for direct / direct_local engines
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS kurzantworten boolean NOT NULL DEFAULT false;
