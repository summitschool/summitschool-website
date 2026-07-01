-- Single notification timestamp for one-time task emails (graduation, K graduation, etc.).
-- Run once in Supabase SQL Editor.

ALTER TABLE public.family_documents
  ADD COLUMN IF NOT EXISTS task_notified_at timestamptz;

-- Existing graduation tasks were already visible; avoid a one-time blast email.
UPDATE public.family_documents
SET task_notified_at = now()
WHERE task_notified_at IS NULL
  AND category ILIKE '%task%'
  AND (
    url LIKE 'hub://graduation/%'
    OR url LIKE 'hub://kindergarten-graduation/%'
  );