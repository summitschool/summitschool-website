-- Prevent concurrent webhook handlers from archiving the same submission twice.
ALTER TABLE public.hub_form_archive_log
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;