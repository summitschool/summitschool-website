-- Code of Conduct completion tracking + cleanup duplicate tasks (run once in Supabase SQL Editor)

ALTER TABLE public.family_onboarding
  ADD COLUMN IF NOT EXISTS conduct_signed_at timestamptz;

COMMENT ON COLUMN public.family_onboarding.conduct_signed_at IS
  'Set when the family completes the Code of Conduct DocuSeal form; prevents re-assigning the task.';

-- Families can read their own hub archive rows (used to detect completed COC on the client)
DROP POLICY IF EXISTS "Families read own hub form archive log" ON public.hub_form_archive_log;
CREATE POLICY "Families read own hub form archive log"
ON public.hub_form_archive_log
FOR SELECT
TO authenticated
USING (family_user_id = auth.uid());

-- Backfill from archived signed PDFs linked in hub_form_archive_log
UPDATE public.family_onboarding fo
SET
  conduct_signed_at = sub.archived_at,
  manual_checks = CASE
    WHEN coalesce((fo.manual_checks ->> 'conduct')::boolean, false) THEN fo.manual_checks
    ELSE coalesce(fo.manual_checks, '{}'::jsonb) || '{"conduct": true}'::jsonb
  END
FROM (
  SELECT
    hf.family_user_id,
    MIN(hf.archived_at) AS archived_at
  FROM public.hub_form_archive_log hf
  JOIN public.family_documents fd ON fd.id = hf.family_document_id
  WHERE hf.archived_at IS NOT NULL
    AND hf.family_user_id IS NOT NULL
    AND fd.category ILIKE '%signed form%'
    AND (
      fd.title ILIKE '%2026 - 2027 scs code of conduct%'
      OR fd.title ILIKE '%scs code of conduct%'
      OR fd.title ILIKE '%code of conduct%'
      OR fd.title ILIKE '%conduct%'
    )
    AND fd.title NOT ILIKE '%driver%'
    AND fd.title NOT ILIKE '%dmv%'
  GROUP BY hf.family_user_id
) sub
WHERE fo.family_user_id = sub.family_user_id
  AND fo.conduct_signed_at IS NULL;

-- Backfill from signed non-task documents (title match)
UPDATE public.family_onboarding fo
SET
  conduct_signed_at = COALESCE(fo.conduct_signed_at, now()),
  manual_checks = CASE
    WHEN coalesce((fo.manual_checks ->> 'conduct')::boolean, false) THEN fo.manual_checks
    ELSE coalesce(fo.manual_checks, '{}'::jsonb) || '{"conduct": true}'::jsonb
  END
FROM public.family_documents fd
WHERE fd.user_id = fo.family_user_id
  AND (
    fd.title ILIKE '%2026 - 2027 scs code of conduct%'
    OR fd.title ILIKE '%scs code of conduct%'
    OR fd.title ILIKE '%code of conduct%'
  )
  AND fd.category NOT ILIKE '%task%'
  AND fo.conduct_signed_at IS NULL;

-- Remove duplicate Code of Conduct tasks for families who already signed
DELETE FROM public.family_documents fd
WHERE fd.category ILIKE '%task%'
  AND fd.title ILIKE '%code of conduct%'
  AND (
    EXISTS (
      SELECT 1
      FROM public.family_onboarding fo
      WHERE fo.family_user_id = fd.user_id
        AND fo.conduct_signed_at IS NOT NULL
    )
    OR EXISTS (
      SELECT 1
      FROM public.family_onboarding fo
      WHERE fo.family_user_id = fd.user_id
        AND coalesce((fo.manual_checks ->> 'conduct')::boolean, false)
    )
    OR EXISTS (
      SELECT 1
      FROM public.family_documents signed
      WHERE signed.user_id = fd.user_id
        AND signed.id <> fd.id
        AND signed.category ILIKE '%signed form%'
        AND (
          signed.title ILIKE '%2026 - 2027 scs code of conduct%'
          OR signed.title ILIKE '%scs code of conduct%'
          OR signed.title ILIKE '%code of conduct%'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.hub_form_archive_log hf
      JOIN public.family_documents archived ON archived.id = hf.family_document_id
      WHERE hf.family_user_id = fd.user_id
        AND hf.archived_at IS NOT NULL
        AND archived.category ILIKE '%signed form%'
        AND (
          archived.title ILIKE '%2026 - 2027 scs code of conduct%'
          OR archived.title ILIKE '%scs code of conduct%'
          OR archived.title ILIKE '%code of conduct%'
          OR archived.title ILIKE '%conduct%'
        )
        AND archived.title NOT ILIKE '%driver%'
        AND archived.title NOT ILIKE '%dmv%'
    )
  );