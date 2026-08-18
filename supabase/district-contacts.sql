-- Remember each public-school district's notification email and contact name.
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.district_contacts (
  district_key text PRIMARY KEY,
  email text,
  contact_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.district_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin staff manage district contacts" ON public.district_contacts;
CREATE POLICY "Admin staff manage district contacts"
ON public.district_contacts
FOR ALL
TO authenticated
USING (
  public.is_full_admin()
  OR public.staff_has_admin_section('families')
  OR public.staff_has_admin_section('academic')
  OR public.staff_has_admin_section('districts')
)
WITH CHECK (
  public.is_full_admin()
  OR public.staff_has_admin_section('families')
  OR public.staff_has_admin_section('academic')
  OR public.staff_has_admin_section('districts')
);
