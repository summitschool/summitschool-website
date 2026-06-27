-- Staff members: read-only access to ALL families' documents and IDs.
-- Run once in Supabase SQL Editor (after or instead of per-family family_viewer_access).

CREATE TABLE IF NOT EXISTS public.staff_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  admin_sections text[] NOT NULL DEFAULT ARRAY['records']::text[]
);

CREATE INDEX IF NOT EXISTS staff_members_user_idx ON public.staff_members (user_id);

ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manages staff members"
ON public.staff_members
FOR ALL
TO authenticated
USING (coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com')
WITH CHECK (coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com');

CREATE POLICY "Staff read own membership row"
ON public.staff_members
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Staff read all family documents"
ON public.family_documents
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.user_id = auth.uid()
  )
);

CREATE POLICY "Staff read all family document storage"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'Family-Documents'
  AND EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.user_id = auth.uid()
  )
);

-- Optional: migrate anyone already granted per-family staff access
INSERT INTO public.staff_members (user_id)
SELECT DISTINCT viewer_user_id
FROM public.family_viewer_access
ON CONFLICT (user_id) DO NOTHING;