-- Staff admin sub-tab permissions (Signups, Families, Family Records, etc.)
-- Run once in Supabase SQL Editor after staff-members.sql.

ALTER TABLE public.staff_members
ADD COLUMN IF NOT EXISTS admin_sections text[] NOT NULL DEFAULT ARRAY['records']::text[];

CREATE OR REPLACE FUNCTION public.staff_has_admin_section(section text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_members sm
    WHERE sm.user_id = auth.uid()
      AND section = ANY(COALESCE(sm.admin_sections, ARRAY['records']::text[]))
  );
$$;

-- Profiles: staff with Signups can approve/deny
CREATE POLICY "Staff signups section update profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.staff_has_admin_section('members'))
WITH CHECK (public.staff_has_admin_section('members'));

-- Family documents: staff with Families can manage uploads/tasks
CREATE POLICY "Staff families section manage family documents"
ON public.family_documents
FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('families')
)
WITH CHECK (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('families')
);

CREATE POLICY "Staff families section write family storage"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'Family-Documents'
  AND public.staff_has_admin_section('families')
);

CREATE POLICY "Staff families section update family storage"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'Family-Documents'
  AND public.staff_has_admin_section('families')
)
WITH CHECK (
  bucket_id = 'Family-Documents'
  AND public.staff_has_admin_section('families')
);

CREATE POLICY "Staff families section delete family storage"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'Family-Documents'
  AND public.staff_has_admin_section('families')
);

-- Shared resources + banners: Site Content section
CREATE POLICY "Staff site section manage shared resources"
ON public.shared_resources
FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('site')
)
WITH CHECK (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('site')
);

CREATE POLICY "Staff site section manage member banners"
ON public.member_banners
FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('site')
)
WITH CHECK (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('site')
);

-- Standard templates: Document Library section
CREATE POLICY "Staff library section manage standard documents"
ON public.standard_documents
FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('library')
)
WITH CHECK (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('library')
);

-- Pending ID review: Signups section
CREATE POLICY "Staff signups section manage id uploads"
ON public.id_uploads
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