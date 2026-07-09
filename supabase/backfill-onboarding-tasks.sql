-- Backfill missing onboarding setup tasks for approved families.
-- Run once in Supabase SQL Editor. Safe to re-run (skips families that already have each task).

-- Ensure onboarding row exists for every approved family
INSERT INTO public.family_onboarding (family_user_id)
SELECT p.id
FROM public.profiles p
WHERE p.approved = true
  AND NOT EXISTS (
    SELECT 1 FROM public.family_onboarding fo
    WHERE fo.family_user_id = p.id
  );

-- Family Hub Setup Checklist task
INSERT INTO public.family_documents (
  user_id, title, description, url, category, school_year, due_date_1, due_date_1_cleared
)
SELECT
  p.id,
  'Family Hub Setup Checklist',
  'Complete every step below, check off each item, then finish this checklist. Other required tasks stay in My Tasks until done.',
  'hub://onboarding',
  'Onboarding (Task)',
  '2026-2027',
  (CURRENT_DATE + INTERVAL '14 days')::date,
  false
FROM public.profiles p
LEFT JOIN public.family_onboarding fo ON fo.family_user_id = p.id
WHERE p.approved = true
  AND fo.completed_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.family_documents fd
    WHERE fd.user_id = p.id
      AND fd.url = 'hub://onboarding'
      AND coalesce(fd.category, '') ILIKE '%task%'
  );

-- Code of Conduct task (skip if signed copy already exists or conduct is marked complete)
INSERT INTO public.family_documents (
  user_id, title, description, url, category, school_year, due_date_1, due_date_1_cleared
)
SELECT
  p.id,
  coalesce(std.title, 'Sign Code of Conduct (required)'),
  coalesce(std.description, 'Read and sign the Summit Church School Code of Conduct.'),
  coalesce(nullif(btrim(std.url), ''), 'https://enroll.summitchurchschool.org/d/3oBpb3Knk9GsNB'),
  coalesce(std.category, 'Policy') || ' (Task)',
  '2026-2027',
  (CURRENT_DATE + INTERVAL '14 days')::date,
  false
FROM public.profiles p
LEFT JOIN public.family_onboarding fo ON fo.family_user_id = p.id
LEFT JOIN LATERAL (
  SELECT title, description, url, category
  FROM public.standard_documents
  WHERE title ILIKE '%code of conduct%'
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1
) std ON true
WHERE p.approved = true
  AND fo.completed_at IS NULL
  AND fo.conduct_signed_at IS NULL
  AND coalesce((fo.manual_checks ->> 'conduct')::boolean, false) = false
  AND NOT EXISTS (
    SELECT 1 FROM public.family_documents fd
    WHERE fd.user_id = p.id
      AND coalesce(fd.title, '') ILIKE '%code of conduct%'
      AND coalesce(fd.category, '') ILIKE '%task%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.family_documents fd
    WHERE fd.user_id = p.id
      AND coalesce(fd.category, '') NOT ILIKE '%task%'
      AND (
        coalesce(fd.title, '') ILIKE '%scs code of conduct%'
        OR coalesce(fd.title, '') ILIKE '%code of conduct%'
      )
  );

-- Upload ID task (skip if ID already approved in family_documents)
INSERT INTO public.family_documents (
  user_id, title, description, url, category, school_year, due_date_1, due_date_1_cleared
)
SELECT
  p.id,
  coalesce(std.title, 'Upload Government Issued ID (required)'),
  coalesce(std.description, 'Upload a clear photo of your current valid driver''s license or government-issued photo ID.'),
  coalesce(std.url, ''),
  coalesce(std.category, 'Verification') || ' (Task)',
  '2026-2027',
  (CURRENT_DATE + INTERVAL '14 days')::date,
  false
FROM public.profiles p
LEFT JOIN public.family_onboarding fo ON fo.family_user_id = p.id
LEFT JOIN LATERAL (
  SELECT title, description, url, category
  FROM public.standard_documents
  WHERE title ILIKE '%Upload Government Issued ID%'
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1
) std ON true
WHERE p.approved = true
  AND fo.completed_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.family_documents fd
    WHERE fd.user_id = p.id
      AND coalesce(fd.title, '') ILIKE '%upload government issued id%'
      AND coalesce(fd.category, '') ILIKE '%task%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.family_documents fd
    WHERE fd.user_id = p.id
      AND coalesce(fd.category, '') ILIKE '%ID%'
      AND coalesce(fd.category, '') NOT ILIKE '%task%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.id_uploads iu
    WHERE iu.user_id = p.id
      AND iu.status IN ('pending', 'approved')
  );