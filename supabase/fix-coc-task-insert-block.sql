-- Stop blocking Code of Conduct task inserts based only on conduct_signed_at.
-- That timestamp could be set incorrectly before a real DocuSeal signature.
-- Run once in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.prevent_duplicate_coc_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_coc_task boolean;
BEGIN
  is_coc_task := COALESCE(NEW.title, '') ILIKE '%code of conduct%'
    AND (
      COALESCE(NEW.category, '') ILIKE '%(task)%'
      OR COALESCE(NEW.category, '') ILIKE '%task%'
    );

  IF NOT is_coc_task THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM family_documents fd
    WHERE fd.user_id = NEW.user_id
      AND fd.id IS DISTINCT FROM NEW.id
      AND (
        fd.title ILIKE '%2026 - 2027 scs code of conduct%'
        OR fd.title ILIKE '%scs code of conduct%'
        OR (
          fd.title ILIKE '%code of conduct%'
          AND COALESCE(fd.category, '') NOT ILIKE '%task%'
          AND COALESCE(fd.category, '') NOT ILIKE '%(task)%'
        )
      )
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Jennie Gil: clear false conduct completion and restore COC + checklist tasks.
UPDATE public.family_onboarding
SET
  conduct_signed_at = NULL,
  completed_at = NULL,
  manual_checks = COALESCE(manual_checks, '{}'::jsonb) || jsonb_build_object('conduct', false)
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
    AND (
      fd.title ILIKE '%code of conduct%'
      OR fd.url ILIKE '%3oBpb3Knk9GsNB%'
    )
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