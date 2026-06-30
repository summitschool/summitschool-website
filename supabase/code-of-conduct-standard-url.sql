-- Ensure Code of Conduct standard uses the live DocuSeal signing link (run once if needed)
UPDATE public.standard_documents
SET url = 'https://enroll.summitchurchschool.org/d/3oBpb3Knk9GsNB'
WHERE title ILIKE '%code of conduct%'
  AND coalesce(url, '') <> 'https://enroll.summitchurchschool.org/d/3oBpb3Knk9GsNB';

-- Fix any in-flight family tasks that were assigned without the signing URL
UPDATE public.family_documents
SET url = 'https://enroll.summitchurchschool.org/d/3oBpb3Knk9GsNB'
WHERE title ILIKE '%code of conduct%'
  AND category ILIKE '%task%'
  AND (
    coalesce(url, '') = ''
    OR url NOT ILIKE '%3oBpb3Knk9GsNB%'
  );