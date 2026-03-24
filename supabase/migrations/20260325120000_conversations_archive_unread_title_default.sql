-- Archive, explicit unread flag, empty default title (no "Neues Gespräch" placeholder for new rows)
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS marked_unread BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.conversations
  ALTER COLUMN title SET DEFAULT '';
