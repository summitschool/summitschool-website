-- Let Families-section staff fix onboarding state and assign setup tasks from the admin Families tab.
-- Without this, only Signups (members) staff or the family themselves can update family_onboarding
-- or insert Code of Conduct / checklist tasks — causing false "success" and missing-task errors.

DROP POLICY IF EXISTS "Staff families section manage family onboarding" ON public.family_onboarding;
CREATE POLICY "Staff families section manage family onboarding"
ON public.family_onboarding
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

DROP POLICY IF EXISTS "Staff families section manage onboarding tasks" ON public.family_documents;
CREATE POLICY "Staff families section manage onboarding tasks"
ON public.family_documents
FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR (
    public.staff_has_admin_section('families')
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
    public.staff_has_admin_section('families')
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