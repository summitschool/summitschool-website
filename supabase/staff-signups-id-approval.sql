-- Let staff with the Signups section approve IDs into family_documents
-- and move files into permanent storage during review.

DROP POLICY IF EXISTS "Staff signups section manage approved family IDs" ON public.family_documents;
CREATE POLICY "Staff signups section manage approved family IDs"
ON public.family_documents
FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR (
    public.staff_has_admin_section('members')
    AND (
      coalesce(category, '') ILIKE '%ID%'
      OR (
        (
          coalesce(category, '') ILIKE '%task%'
          OR coalesce(category, '') ILIKE '%(task)%'
        )
        AND coalesce(title, '') ILIKE '%upload government issued id%'
      )
    )
  )
)
WITH CHECK (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR (
    public.staff_has_admin_section('members')
    AND (
      coalesce(category, '') ILIKE '%ID%'
      OR (
        (
          coalesce(category, '') ILIKE '%task%'
          OR coalesce(category, '') ILIKE '%(task)%'
        )
        AND coalesce(title, '') ILIKE '%upload government issued id%'
      )
    )
  )
);

DROP POLICY IF EXISTS "Staff signups section manage family onboarding" ON public.family_onboarding;
CREATE POLICY "Staff signups section manage family onboarding"
ON public.family_onboarding
FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('members')
)
WITH CHECK (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('members')
);

DROP POLICY IF EXISTS "Staff signups section write approved family ID storage" ON storage.objects;
CREATE POLICY "Staff signups section write approved family ID storage"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'Family-Documents'
  AND public.staff_has_admin_section('members')
  AND name ~ '^[0-9a-f-]{36}/ids/'
);

DROP POLICY IF EXISTS "Staff signups section update approved family ID storage" ON storage.objects;
CREATE POLICY "Staff signups section update approved family ID storage"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'Family-Documents'
  AND public.staff_has_admin_section('members')
  AND name ~ '^[0-9a-f-]{36}/ids/'
)
WITH CHECK (
  bucket_id = 'Family-Documents'
  AND public.staff_has_admin_section('members')
  AND name ~ '^[0-9a-f-]{36}/ids/'
);