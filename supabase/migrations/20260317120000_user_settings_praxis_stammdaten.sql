-- Add praxis_stammdaten JSONB to user_settings for PDF export (Praxis + Bank, once per user)
-- Structure: { praxis: { name, adresse, telefon, email, steuernummer }, bank: { iban, bic, bankName, kontoinhaber } }
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS praxis_stammdaten JSONB DEFAULT NULL;
