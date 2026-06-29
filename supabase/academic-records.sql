-- Academic Records: students, school-year grade ledgers, progress reports.
-- Run once in Supabase SQL Editor after family_documents / staff policies exist.
--
-- Tables:
--   students              — one row per enrolled child per family
--   student_school_years  — grade level + lock state per student per school year
--   grade_entries         — courses and grades (semester or full-year backfill)
--   family_onboarding     — checklist progress for new families

-- ---------------------------------------------------------------------------
-- Students
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL DEFAULT '',
  current_grade_level text,
  prior_years_status text NOT NULL DEFAULT 'pending'
    CHECK (prior_years_status IN ('pending', 'complete', 'not_applicable')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS students_family_user_id_idx
  ON public.students (family_user_id);

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- School year records (current-year progress or backfill)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_school_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  school_year text NOT NULL,
  grade_level text NOT NULL,
  entry_type text NOT NULL DEFAULT 'current'
    CHECK (entry_type IN ('current', 'backfill')),
  semester_1_locked boolean NOT NULL DEFAULT false,
  semester_1_submitted_at timestamptz,
  semester_1_ack_name text,
  semester_2_locked boolean NOT NULL DEFAULT false,
  semester_2_submitted_at timestamptz,
  semester_2_ack_name text,
  year_locked boolean NOT NULL DEFAULT false,
  year_submitted_at timestamptz,
  year_ack_name text,
  admin_reopened_at timestamptz,
  admin_reopened_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, school_year)
);

CREATE INDEX IF NOT EXISTS student_school_years_student_id_idx
  ON public.student_school_years (student_id);

ALTER TABLE public.student_school_years ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Grade entries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grade_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_year_record_id uuid NOT NULL REFERENCES public.student_school_years(id) ON DELETE CASCADE,
  course_name text NOT NULL,
  course_type text,
  is_core boolean NOT NULL DEFAULT false,
  semester_1_grade text,
  semester_2_grade text,
  final_grade text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS grade_entries_school_year_record_id_idx
  ON public.grade_entries (school_year_record_id);

ALTER TABLE public.grade_entries ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Onboarding checklist state (ID task is separate)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.family_onboarding (
  family_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  guide_read boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.family_onboarding ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RLS: families manage own rows; admin + staff families section read/manage all
-- ---------------------------------------------------------------------------
CREATE POLICY "Users manage own students"
ON public.students
FOR ALL
TO authenticated
USING (family_user_id = auth.uid())
WITH CHECK (family_user_id = auth.uid());

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

CREATE POLICY "Users manage own student school years"
ON public.student_school_years
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = student_school_years.student_id
      AND s.family_user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = student_school_years.student_id
      AND s.family_user_id = auth.uid()
  )
);

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

CREATE POLICY "Users manage own grade entries"
ON public.grade_entries
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.student_school_years y
    JOIN public.students s ON s.id = y.student_id
    WHERE y.id = grade_entries.school_year_record_id
      AND s.family_user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.student_school_years y
    JOIN public.students s ON s.id = y.student_id
    WHERE y.id = grade_entries.school_year_record_id
      AND s.family_user_id = auth.uid()
  )
);

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

CREATE POLICY "Users manage own onboarding"
ON public.family_onboarding
FOR ALL
TO authenticated
USING (family_user_id = auth.uid())
WITH CHECK (family_user_id = auth.uid());

CREATE POLICY "Staff read all onboarding"
ON public.family_onboarding
FOR SELECT
TO authenticated
USING (
  coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com'
  OR public.staff_has_admin_section('families')
  OR public.staff_has_admin_section('academic')
);

COMMENT ON TABLE public.students IS
  'Enrolled students per Family Hub account. prior_years_status: pending until backfill done or marked not_applicable (required for HS).';
COMMENT ON TABLE public.student_school_years IS
  'Per-student school year ledger. entry_type current = semester progress report; backfill = full-year prior record.';
COMMENT ON TABLE public.grade_entries IS
  'Course grades. Backfill uses final_grade only; current year uses semester_1/semester_2/final as applicable.';