-- Ensure full admin can delete staff_members rows (fixes silent no-op deletes).
-- Run once in Supabase SQL Editor if Remove staff does nothing in the UI.

GRANT DELETE ON public.staff_members TO authenticated;

DROP POLICY IF EXISTS "Admin deletes staff members" ON public.staff_members;
CREATE POLICY "Admin deletes staff members"
ON public.staff_members
FOR DELETE
TO authenticated
USING (coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com');