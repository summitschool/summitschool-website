-- Attendance (school days) per semester on current-year progress reports.
-- Run once in Supabase SQL Editor after academic-records.sql.

ALTER TABLE public.student_school_years
  ADD COLUMN IF NOT EXISTS semester_1_attendance_days integer,
  ADD COLUMN IF NOT EXISTS semester_2_attendance_days integer;

COMMENT ON COLUMN public.student_school_years.semester_1_attendance_days IS
  'School days attended in Semester 1 (Jul–Dec) for current-year progress reports.';
COMMENT ON COLUMN public.student_school_years.semester_2_attendance_days IS
  'School days attended in Semester 2 (Jan–May) for current-year progress reports.';