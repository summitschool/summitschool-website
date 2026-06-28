-- Staff with Signups (members) section can read profiles for pending approvals and ID review.
-- Run once in Supabase SQL Editor after staff-admin-sections.sql.

CREATE POLICY "Staff signups section read profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.staff_has_admin_section('members'));