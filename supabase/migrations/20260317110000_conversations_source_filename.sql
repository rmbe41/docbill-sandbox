-- Add source_filename to conversations for displaying the invoice/receipt file in history
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS source_filename TEXT;
