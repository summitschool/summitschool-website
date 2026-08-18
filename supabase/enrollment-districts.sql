-- Public school district + enrollment-packet student rows (name, DOB, grade).
-- Run once in the Supabase SQL Editor.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS public_school_district text;

CREATE INDEX IF NOT EXISTS profiles_public_school_district_idx
  ON public.profiles (public_school_district);

ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS date_of_birth date;

CREATE TABLE IF NOT EXISTS public.enrollment_packet_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  date_of_birth date,
  grade_label text,
  public_school_district text,
  source_document_id uuid,
  school_year text NOT NULL DEFAULT '2026-2027',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS enrollment_packet_students_family_name_year_idx
  ON public.enrollment_packet_students (
    family_user_id,
    lower(btrim(full_name)),
    school_year
  );

CREATE INDEX IF NOT EXISTS enrollment_packet_students_district_idx
  ON public.enrollment_packet_students (public_school_district);

CREATE INDEX IF NOT EXISTS enrollment_packet_students_family_idx
  ON public.enrollment_packet_students (family_user_id);

ALTER TABLE public.enrollment_packet_students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin staff manage enrollment packet students" ON public.enrollment_packet_students;
CREATE POLICY "Admin staff manage enrollment packet students"
ON public.enrollment_packet_students
FOR ALL
TO authenticated
USING (
  public.is_full_admin()
  OR public.staff_has_admin_section('families')
  OR public.staff_has_admin_section('academic')
)
WITH CHECK (
  public.is_full_admin()
  OR public.staff_has_admin_section('families')
  OR public.staff_has_admin_section('academic')
);

DROP POLICY IF EXISTS "Staff update family school district" ON public.profiles;
CREATE POLICY "Staff update family school district"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  public.is_full_admin()
  OR public.staff_has_admin_section('families')
  OR public.staff_has_admin_section('academic')
)
WITH CHECK (
  public.is_full_admin()
  OR public.staff_has_admin_section('families')
  OR public.staff_has_admin_section('academic')
);
