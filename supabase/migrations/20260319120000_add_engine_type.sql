-- Add engine_type to user_settings and default_engine to global_settings
-- Values: 'simple' | 'complex'

ALTER TABLE public.global_settings
  ADD COLUMN IF NOT EXISTS default_engine text NOT NULL DEFAULT 'complex';

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS engine_type text;
