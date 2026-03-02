
CREATE TABLE public.global_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  default_model text NOT NULL DEFAULT 'google/gemini-2.5-flash',
  default_rules text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.global_settings (default_model, default_rules) VALUES (
  'google/gemini-2.5-flash',
  'Antworte immer auf Deutsch. Beachte die DSGVO. Empfehle keine rechtswidrigen Abrechnungspraktiken.'
);

CREATE TABLE public.user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  selected_model text,
  custom_rules text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.global_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read global settings"
  ON public.global_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anyone can update global settings"
  ON public.global_settings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own settings"
  ON public.user_settings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
  ON public.user_settings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON public.user_settings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own settings"
  ON public.user_settings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
