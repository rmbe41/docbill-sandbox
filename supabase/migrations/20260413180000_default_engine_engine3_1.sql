-- Product default: Engine 3.1 (GOÄ v2). Fresh rows inherit this; existing globals on legacy defaults are upgraded.
ALTER TABLE public.global_settings
  ALTER COLUMN default_engine SET DEFAULT 'engine3_1';

UPDATE public.global_settings
SET default_engine = 'engine3_1'
WHERE default_engine IN ('complex', 'engine3');
