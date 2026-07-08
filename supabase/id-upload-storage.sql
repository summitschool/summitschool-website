-- Allow families to upload pending ID photos from My Tasks (run once in Supabase SQL Editor)

DROP POLICY IF EXISTS "Families upload own ID photos" ON storage.objects;
CREATE POLICY "Families upload own ID photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'Family-Documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND (
    name ~~ '%/ids/pending/%'
    OR name ~~ 'temp-ids/%'
  )
);