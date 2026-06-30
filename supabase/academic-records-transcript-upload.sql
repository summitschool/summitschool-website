-- Optional official transcript photo for high school prior-year backfill records.
-- Run once in Supabase SQL Editor after academic-records.sql.

ALTER TABLE public.student_school_years
ADD COLUMN IF NOT EXISTS transcript_storage_path text,
ADD COLUMN IF NOT EXISTS transcript_uploaded_at timestamptz,
ADD COLUMN IF NOT EXISTS transcript_file_name text;

COMMENT ON COLUMN public.student_school_years.transcript_storage_path IS
  'Family-Documents storage path for optional prior-year official transcript photo/PDF.';

-- Families may upload and read files under their own folder for academic records.
CREATE POLICY "Families upload own academic record files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'Family-Documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND name LIKE '%/academic-records/%'
);

CREATE POLICY "Families read own academic record files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'Family-Documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Families update own academic record files"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'Family-Documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'Family-Documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);