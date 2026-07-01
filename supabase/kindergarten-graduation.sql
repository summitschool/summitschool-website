-- Kindergarten graduation hub infrastructure (mirrors senior graduation for grade K).
-- Form/workflow UI will be built later; this prepares settings, submissions, and tasks.
-- Run once in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.kindergarten_graduation_settings (
  school_year text PRIMARY KEY,
  base_fee numeric(10,2),
  dues_due_date date,
  ceremony_date date,
  practice_date date,
  requirements_text text,
  payment_note_hint text NOT NULL DEFAULT 'Include your kindergartener''s full name in your payment note.',
  paypal_username text NOT NULL DEFAULT 'macraesmom',
  cashapp_cashtag text NOT NULL DEFAULT 'SummitExplorers',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.kindergarten_graduation_settings (school_year, requirements_text)
VALUES (
  '2026-2027',
  E'Kindergarten graduation details and ordering requirements will be posted here.\n\nThe school office will notify families when the order form is ready.'
)
ON CONFLICT (school_year) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.kindergarten_graduation_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_year text NOT NULL,
  family_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'changes_requested', 'approved')),
  form_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_due numeric(10,2) NOT NULL DEFAULT 0,
  payment_method text,
  payment_amount numeric(10,2),
  payment_note text,
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'pending_verification', 'paid')),
  admin_marked_paid_at timestamptz,
  admin_payment_method text,
  admin_payment_note text,
  family_ack_name text,
  family_submitted_at timestamptz,
  admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_ack_name text,
  admin_approved_at timestamptz,
  admin_notes text,
  pdf_storage_path text,
  family_document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS kindergarten_graduation_submissions_student_year_idx
  ON public.kindergarten_graduation_submissions (student_id, school_year);

CREATE INDEX IF NOT EXISTS kindergarten_graduation_submissions_year_status_idx
  ON public.kindergarten_graduation_submissions (school_year, status);

ALTER TABLE public.kindergarten_graduation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kindergarten_graduation_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read kindergarten graduation settings" ON public.kindergarten_graduation_settings;
CREATE POLICY "Public read kindergarten graduation settings"
ON public.kindergarten_graduation_settings FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admin manages kindergarten graduation settings" ON public.kindergarten_graduation_settings;
CREATE POLICY "Admin manages kindergarten graduation settings"
ON public.kindergarten_graduation_settings FOR ALL TO authenticated
USING (public.is_staff_member())
WITH CHECK (public.is_staff_member());

DROP POLICY IF EXISTS "Family read own kindergarten graduation submissions" ON public.kindergarten_graduation_submissions;
CREATE POLICY "Family read own kindergarten graduation submissions"
ON public.kindergarten_graduation_submissions FOR SELECT TO authenticated
USING (family_user_id = auth.uid());

DROP POLICY IF EXISTS "Family insert own kindergarten graduation submissions" ON public.kindergarten_graduation_submissions;
CREATE POLICY "Family insert own kindergarten graduation submissions"
ON public.kindergarten_graduation_submissions FOR INSERT TO authenticated
WITH CHECK (family_user_id = auth.uid());

DROP POLICY IF EXISTS "Family update own draft kindergarten graduation submissions" ON public.kindergarten_graduation_submissions;
CREATE POLICY "Family update own draft kindergarten graduation submissions"
ON public.kindergarten_graduation_submissions FOR UPDATE TO authenticated
USING (family_user_id = auth.uid() AND status IN ('draft', 'changes_requested'))
WITH CHECK (family_user_id = auth.uid());

DROP POLICY IF EXISTS "Staff read all kindergarten graduation submissions" ON public.kindergarten_graduation_submissions;
CREATE POLICY "Staff read all kindergarten graduation submissions"
ON public.kindergarten_graduation_submissions FOR SELECT TO authenticated
USING (public.is_staff_member());

DROP POLICY IF EXISTS "Staff update kindergarten graduation submissions" ON public.kindergarten_graduation_submissions;
CREATE POLICY "Staff update kindergarten graduation submissions"
ON public.kindergarten_graduation_submissions FOR UPDATE TO authenticated
USING (public.is_staff_member())
WITH CHECK (public.is_staff_member());

DROP POLICY IF EXISTS "Staff insert kindergarten graduation submissions" ON public.kindergarten_graduation_submissions;
CREATE POLICY "Staff insert kindergarten graduation submissions"
ON public.kindergarten_graduation_submissions FOR INSERT TO authenticated
WITH CHECK (public.is_staff_member());

-- Retroactive task backfill: kindergarteners with Semester 1 locked (same trigger as senior graduation).
INSERT INTO public.family_documents (user_id, title, description, url, category, school_year, due_date_1, due_date_1_cleared)
SELECT
  s.family_user_id,
  'Kindergarten Graduation — ' || trim(s.first_name || ' ' || coalesce(s.last_name, '')),
  'Complete your kindergartener''s graduation order when the form opens in the Family Hub.',
  'hub://kindergarten-graduation/' || s.id::text,
  'Kindergarten Graduation (Task)',
  ssy.school_year,
  kgs.dues_due_date,
  false
FROM public.students s
JOIN public.student_school_years ssy
  ON ssy.student_id = s.id
 AND ssy.entry_type = 'current'
 AND ssy.semester_1_locked = true
JOIN public.kindergarten_graduation_settings kgs ON kgs.school_year = ssy.school_year
WHERE s.current_grade_level = 'K'
  AND NOT EXISTS (
    SELECT 1 FROM public.family_documents fd
    WHERE fd.user_id = s.family_user_id
      AND fd.url = 'hub://kindergarten-graduation/' || s.id::text
      AND fd.category ILIKE '%task%'
  );