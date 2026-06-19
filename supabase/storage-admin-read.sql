-- Run once in Supabase SQL Editor so the admin account can preview and move ID files.
-- Replace the email if your admin login changes.

CREATE POLICY "Admin can read family document storage"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'Family-Documents'
  AND coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
);

CREATE POLICY "Admin can write family document storage"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'Family-Documents'
  AND coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
);

CREATE POLICY "Admin can update family document storage"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'Family-Documents'
  AND coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
)
WITH CHECK (
  bucket_id = 'Family-Documents'
  AND coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
);

CREATE POLICY "Admin can delete family document storage"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'Family-Documents'
  AND coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
);