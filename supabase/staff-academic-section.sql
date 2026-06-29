-- Staff Academic Records admin section permissions.
-- Run once in Supabase SQL Editor after staff-admin-sections.sql and academic-records.sql.

-- Approved family list for Academic Records admin tab
CREATE POLICY "Staff academic section read profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('academic')
  OR public.staff_has_admin_section('families')
);

-- Academic tables: staff with Academic Records section (in addition to Families)
DROP POLICY IF EXISTS "Staff manage all students" ON public.students;
CREATE POLICY "Staff manage all students"
ON public.students
FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('families')
  OR public.staff_has_admin_section('academic')
)
WITH CHECK (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('families')
  OR public.staff_has_admin_section('academic')
);

DROP POLICY IF EXISTS "Staff manage all student school years" ON public.student_school_years;
CREATE POLICY "Staff manage all student school years"
ON public.student_school_years
FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('families')
  OR public.staff_has_admin_section('academic')
)
WITH CHECK (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('families')
  OR public.staff_has_admin_section('academic')
);

DROP POLICY IF EXISTS "Staff manage all grade entries" ON public.grade_entries;
CREATE POLICY "Staff manage all grade entries"
ON public.grade_entries
FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('families')
  OR public.staff_has_admin_section('academic')
)
WITH CHECK (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('families')
  OR public.staff_has_admin_section('academic')
);

DROP POLICY IF EXISTS "Staff read all onboarding" ON public.family_onboarding;
CREATE POLICY "Staff read all onboarding"
ON public.family_onboarding
FOR SELECT
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('families')
  OR public.staff_has_admin_section('academic')
);