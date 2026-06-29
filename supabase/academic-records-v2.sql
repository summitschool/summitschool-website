-- Academic records v2: course types for transcript/credit tracking.
-- Run once after academic-records.sql.

ALTER TABLE public.grade_entries
ADD COLUMN IF NOT EXISTS course_type text;

-- Backfill course_type from legacy generic course names
UPDATE public.grade_entries SET course_type = 'english'
WHERE course_type IS NULL AND (
  course_name ILIKE '%english%' OR course_name ILIKE '%language arts%'
);
UPDATE public.grade_entries SET course_type = 'math'
WHERE course_type IS NULL AND course_name ILIKE '%math%';
UPDATE public.grade_entries SET course_type = 'science'
WHERE course_type IS NULL AND course_name ILIKE '%science%';
UPDATE public.grade_entries SET course_type = 'history'
WHERE course_type IS NULL AND (
  course_name ILIKE '%history%' OR course_name ILIKE '%social studies%'
);
UPDATE public.grade_entries SET course_type = 'reading'
WHERE course_type IS NULL AND course_name ILIKE '%reading%';
UPDATE public.grade_entries SET course_type = 'bible'
WHERE course_type IS NULL AND course_name ILIKE '%bible%';
UPDATE public.grade_entries SET course_type = 'pe'
WHERE course_type IS NULL AND (
  course_name ILIKE '%physical education%' OR course_name ILIKE '%pe%'
);
UPDATE public.grade_entries SET course_type = 'elective'
WHERE course_type IS NULL AND is_core = false;
UPDATE public.grade_entries SET course_type = 'other'
WHERE course_type IS NULL;

-- Clear generic placeholder titles so parents enter specific course names
UPDATE public.grade_entries SET course_name = ''
WHERE course_name IN (
  'English / Language Arts',
  'Math',
  'Science',
  'Social Studies / History',
  'Reading',
  'Bible',
  'Physical Education'
);

COMMENT ON COLUMN public.grade_entries.course_type IS
  'Transcript category: english, math, science, history, elective (plus reading, bible, pe, other for lower grades).';