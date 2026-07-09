-- Let Signups staff (members section) assign onboarding setup tasks on approval.
-- Without this, approving a family only creates the ID task — not the checklist or Code of Conduct.
-- Run once in Supabase SQL Editor after staff-signups-id-approval.sql.

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
        AND (
          coalesce(title, '') ILIKE '%upload government issued id%'
          OR coalesce(url, '') = 'hub://onboarding'
          OR coalesce(title, '') ILIKE '%family hub setup checklist%'
          OR coalesce(title, '') ILIKE '%code of conduct%'
        )
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
        AND (
          coalesce(title, '') ILIKE '%upload government issued id%'
          OR coalesce(url, '') = 'hub://onboarding'
          OR coalesce(title, '') ILIKE '%family hub setup checklist%'
          OR coalesce(title, '') ILIKE '%code of conduct%'
        )
      )
    )
  )
);