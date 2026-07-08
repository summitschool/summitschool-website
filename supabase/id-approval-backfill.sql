-- Restore approved ID records that were deleted after admin approval
-- when the file was still stored under ids/pending/.

INSERT INTO public.family_documents (user_id, title, description, url, category, school_year)
SELECT
  iu.user_id,
  'Government ID on File',
  CASE
    WHEN coalesce(iu.ack_name, '') <> '' THEN 'Acknowledged by: ' || iu.ack_name
    ELSE 'ID on file'
  END,
  iu.storage_path,
  'ID',
  coalesce(iu.school_year, '2026-2027')
FROM public.id_uploads iu
WHERE iu.status = 'approved'
  AND NOT EXISTS (
    SELECT 1
    FROM public.family_documents fd
    WHERE fd.user_id = iu.user_id
      AND fd.title ILIKE '%Government ID on File%'
  );