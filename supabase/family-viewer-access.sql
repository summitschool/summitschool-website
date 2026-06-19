-- Staff/delegate read-only access to specific families' documents and IDs.
-- Run once in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.family_viewer_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (viewer_user_id, family_user_id)
);

CREATE INDEX IF NOT EXISTS family_viewer_access_viewer_idx
  ON public.family_viewer_access (viewer_user_id);

CREATE INDEX IF NOT EXISTS family_viewer_access_family_idx
  ON public.family_viewer_access (family_user_id);

ALTER TABLE public.family_viewer_access ENABLE ROW LEVEL SECURITY;

-- Admin (by email) can manage all assignments
CREATE POLICY "Admin manages family viewer access"
ON public.family_viewer_access
FOR ALL
TO authenticated
USING (coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com')
WITH CHECK (coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com');

-- Staff viewers can read their own assignment rows
CREATE POLICY "Viewers read own family access"
ON public.family_viewer_access
FOR SELECT
TO authenticated
USING (viewer_user_id = auth.uid());

-- Allow staff viewers to read assigned families' document rows
CREATE POLICY "Family viewers read assigned family documents"
ON public.family_documents
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.family_viewer_access fva
    WHERE fva.viewer_user_id = auth.uid()
      AND fva.family_user_id = family_documents.user_id
  )
);

-- Allow staff viewers to read assigned families' storage files
CREATE POLICY "Family viewers read assigned family storage"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'Family-Documents'
  AND EXISTS (
    SELECT 1
    FROM public.family_viewer_access fva
    WHERE fva.viewer_user_id = auth.uid()
      AND fva.family_user_id::text = (storage.foldername(name))[1]
  )
);