-- Progress report task visibility windows and notification tracking.
-- Tasks appear in My Tasks on the 1st of the due month (Dec 1 / May 1), not before.
-- Run once in Supabase SQL Editor.

ALTER TABLE public.family_documents
  ADD COLUMN IF NOT EXISTS visible_from_1 date,
  ADD COLUMN IF NOT EXISTS visible_from_2 date,
  ADD COLUMN IF NOT EXISTS notified_semester_1_at timestamptz,
  ADD COLUMN IF NOT EXISTS notified_semester_2_at timestamptz;

-- Backfill visibility windows for existing progress report tasks.
UPDATE public.family_documents fd
SET
  visible_from_1 = COALESCE(
    visible_from_1,
    (split_part(fd.school_year, '-', 1) || '-12-01')::date
  ),
  visible_from_2 = COALESCE(
    visible_from_2,
    (split_part(fd.school_year, '-', 2) || '-05-01')::date
  )
WHERE fd.category ILIKE '%progress report%'
  AND fd.category ILIKE '%task%';