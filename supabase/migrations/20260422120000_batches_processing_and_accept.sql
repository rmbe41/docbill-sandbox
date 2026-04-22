-- Verarbeitungsfortschritt + Übernahme-Metriken (Spec 03)

ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS verarbeitet_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.batch_rechnungen
  ADD COLUMN IF NOT EXISTS vorschlaege_angenommen boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aenderungen_anzahl integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS optimierung_angewendet_euro numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.batches.verarbeitet_count IS 'Fortschritt 0..rechnungen_count während status=processing';
COMMENT ON COLUMN public.batch_rechnungen.vorschlaege_angenommen IS 'Alle lokalen Vorschläge übernommen (Bulk akzeptieren)';
COMMENT ON COLUMN public.batch_rechnungen.aenderungen_anzahl IS 'Anzahl abgeschlossener Optimierungs-/Korrekturpositionen bei Übernahme';
COMMENT ON COLUMN public.batch_rechnungen.optimierung_angewendet_euro IS 'Summe Betrags-Δ bei Übernahme (Euro)';
