-- User preference: embed GOÄ catalog/rules + admin RAG in LLM prompts (default on)
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS kontext_wissen boolean NOT NULL DEFAULT true;
