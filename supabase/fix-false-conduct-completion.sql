-- Undo Code of Conduct marked complete when no signed COC exists on file.
-- Run once in Supabase SQL Editor.

UPDATE public.family_onboarding fo
SET
  conduct_signed_at = NULL,
  manual_checks = COALESCE(fo.manual_checks, '{}'::jsonb) || jsonb_build_object('conduct', false)
WHERE (
  fo.conduct_signed_at IS NOT NULL
  OR COALESCE((fo.manual_checks ->> 'conduct')::boolean, false) = true
)
AND NOT EXISTS (
  SELECT 1
  FROM public.family_documents fd
  WHERE fd.user_id = fo.family_user_id
    AND COALESCE(fd.category, '') NOT ILIKE '%task%'
    AND (
      COALESCE(fd.title, '') ILIKE '%scs code of conduct%'
      OR COALESCE(fd.title, '') ILIKE '%code of conduct%'
    )
)
AND NOT EXISTS (
  SELECT 1
  FROM public.hub_form_archive_log h
  WHERE h.family_user_id = fo.family_user_id
    AND h.archived_at IS NOT NULL
);

-- Jennie Gil completed the checklist without a signed Code of Conduct — reopen it.
UPDATE public.family_onboarding
SET completed_at = NULL
WHERE family_user_id = '37d2130c-daf9-4921-95a2-a0785be0e371';

INSERT INTO public.family_documents (
  user_id, title, description, url, category, school_year, due_date_1, due_date_1_cleared
)
SELECT
  '37d2130c-daf9-4921-95a2-a0785be0e371',
  COALESCE(std.title, 'Sign Code of Conduct (required)'),
  COALESCE(std.description, 'Read and sign the Summit Church School Code of Conduct.'),
  COALESCE(NULLIF(BTRIM(std.url), ''), 'https://enroll.summitchurchschool.org/d/3oBpb3Knk9GsNB'),
  COALESCE(std.category, 'Policy') || ' (Task)',
  '2026-2027',
  (CURRENT_DATE + INTERVAL '14 days')::date,
  false
FROM (
  SELECT title, description, url, category
  FROM public.standard_documents
  WHERE title ILIKE '%code of conduct%'
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1
) std
WHERE NOT EXISTS (
  SELECT 1
  FROM public.family_documents fd
  WHERE fd.user_id = '37d2130c-daf9-4921-95a2-a0785be0e371'
    AND COALESCE(fd.title, '') ILIKE '%code of conduct%'
    AND COALESCE(fd.category, '') ILIKE '%task%'
);

INSERT INTO public.family_documents (
  user_id, title, description, url, category, school_year, due_date_1, due_date_1_cleared
)
SELECT
  '37d2130c-daf9-4921-95a2-a0785be0e371',
  'Family Hub Setup Checklist',
  'Complete every step below, check off each item, then finish this checklist. Other required tasks stay in My Tasks until done.',
  'hub://onboarding',
  'Onboarding (Task)',
  '2026-2027',
  (CURRENT_DATE + INTERVAL '14 days')::date,
  false
WHERE NOT EXISTS (
  SELECT 1
  FROM public.family_documents fd
  WHERE fd.user_id = '37d2130c-daf9-4921-95a2-a0785be0e371'
    AND fd.url = 'hub://onboarding'
    AND COALESCE(fd.category, '') ILIKE '%task%'
);