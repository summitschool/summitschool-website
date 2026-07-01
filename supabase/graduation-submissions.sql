-- Senior Graduation Hub: settings, guest invites, submissions, task backfill.
-- Run once in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.graduation_settings (
  school_year text PRIMARY KEY,
  summit_base_fee numeric(10,2) NOT NULL DEFAULT 65,
  guest_base_fee numeric(10,2) NOT NULL DEFAULT 85,
  pictures_fee numeric(10,2) NOT NULL DEFAULT 20,
  tshirt_youth_fee numeric(10,2) NOT NULL DEFAULT 15,
  tshirt_adult_fee numeric(10,2) NOT NULL DEFAULT 18,
  honor_cord_fee numeric(10,2) NOT NULL DEFAULT 8,
  ceremony_opt_out_fee numeric(10,2),
  dues_due_date date NOT NULL DEFAULT '2027-03-01',
  ceremony_date date NOT NULL DEFAULT '2027-05-22',
  practice_date date NOT NULL DEFAULT '2027-05-21',
  pictures_date date,
  paypal_username text NOT NULL DEFAULT 'macraesmom',
  cashapp_cashtag text NOT NULL DEFAULT 'SummitExplorers',
  payment_note_hint text NOT NULL DEFAULT 'Include the graduate''s full name in your payment note.',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.graduation_settings (school_year)
VALUES ('2026-2027')
ON CONFLICT (school_year) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.graduation_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_year text NOT NULL DEFAULT '2026-2027',
  student_name text NOT NULL,
  parent_name text,
  parent_email text,
  cover_notes text,
  invite_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  created_by_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS graduation_guests_token_idx ON public.graduation_guests (invite_token);
CREATE INDEX IF NOT EXISTS graduation_guests_year_idx ON public.graduation_guests (school_year);

CREATE TABLE IF NOT EXISTS public.graduation_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_year text NOT NULL,
  participant_type text NOT NULL CHECK (participant_type IN ('summit_senior', 'guest')),
  family_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES public.graduation_guests(id) ON DELETE CASCADE,
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
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graduation_submissions_participant_check CHECK (
    (participant_type = 'summit_senior' AND student_id IS NOT NULL)
    OR (participant_type = 'guest' AND guest_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS graduation_submissions_student_year_idx
  ON public.graduation_submissions (student_id, school_year)
  WHERE student_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS graduation_submissions_guest_year_idx
  ON public.graduation_submissions (guest_id, school_year)
  WHERE guest_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS graduation_submissions_year_status_idx
  ON public.graduation_submissions (school_year, status);

ALTER TABLE public.graduation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.graduation_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.graduation_submissions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_full_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(auth.jwt() ->> 'email', '') = 'sjesimon@gmail.com';
$$;

CREATE OR REPLACE FUNCTION public.is_staff_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_members sm WHERE sm.user_id = auth.uid()
  ) OR public.is_full_admin();
$$;

DROP POLICY IF EXISTS "Authenticated read graduation settings" ON public.graduation_settings;
CREATE POLICY "Public read graduation settings"
ON public.graduation_settings FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admin manages graduation settings" ON public.graduation_settings;
CREATE POLICY "Admin manages graduation settings"
ON public.graduation_settings FOR ALL TO authenticated
USING (public.is_full_admin())
WITH CHECK (public.is_full_admin());

DROP POLICY IF EXISTS "Admin staff manage graduation guests" ON public.graduation_guests;
CREATE POLICY "Admin staff manage graduation guests"
ON public.graduation_guests FOR ALL TO authenticated
USING (public.is_staff_member())
WITH CHECK (public.is_staff_member());

DROP POLICY IF EXISTS "Family read own graduation submissions" ON public.graduation_submissions;
CREATE POLICY "Family read own graduation submissions"
ON public.graduation_submissions FOR SELECT TO authenticated
USING (family_user_id = auth.uid());

DROP POLICY IF EXISTS "Family insert own graduation submissions" ON public.graduation_submissions;
CREATE POLICY "Family insert own graduation submissions"
ON public.graduation_submissions FOR INSERT TO authenticated
WITH CHECK (family_user_id = auth.uid());

DROP POLICY IF EXISTS "Family update own draft graduation submissions" ON public.graduation_submissions;
CREATE POLICY "Family update own draft graduation submissions"
ON public.graduation_submissions FOR UPDATE TO authenticated
USING (family_user_id = auth.uid() AND status IN ('draft', 'changes_requested'))
WITH CHECK (family_user_id = auth.uid());

DROP POLICY IF EXISTS "Staff read all graduation submissions" ON public.graduation_submissions;
CREATE POLICY "Staff read all graduation submissions"
ON public.graduation_submissions FOR SELECT TO authenticated
USING (public.is_staff_member());

DROP POLICY IF EXISTS "Staff update graduation submissions" ON public.graduation_submissions;
CREATE POLICY "Staff update graduation submissions"
ON public.graduation_submissions FOR UPDATE TO authenticated
USING (public.is_staff_member())
WITH CHECK (public.is_staff_member());

DROP POLICY IF EXISTS "Staff insert graduation submissions" ON public.graduation_submissions;
CREATE POLICY "Staff insert graduation submissions"
ON public.graduation_submissions FOR INSERT TO authenticated
WITH CHECK (public.is_staff_member());

CREATE OR REPLACE FUNCTION public.get_graduation_guest_by_token(p_token text)
RETURNS TABLE (
  id uuid,
  school_year text,
  student_name text,
  parent_name text,
  parent_email text,
  cover_notes text,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.id, g.school_year, g.student_name, g.parent_name, g.parent_email, g.cover_notes, g.expires_at
  FROM public.graduation_guests g
  WHERE g.invite_token = btrim(p_token)
    AND (g.expires_at IS NULL OR g.expires_at > now())
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_graduation_guest_by_token(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_graduation_submission_by_guest_token(p_token text)
RETURNS SETOF public.graduation_submissions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.*
  FROM public.graduation_submissions s
  JOIN public.graduation_guests g ON g.id = s.guest_id
  WHERE g.invite_token = btrim(p_token)
    AND (g.expires_at IS NULL OR g.expires_at > now())
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_graduation_submission_by_guest_token(text) TO anon, authenticated;

INSERT INTO public.family_documents (user_id, title, description, url, category, school_year, due_date_1, due_date_1_cleared)
SELECT
  s.family_user_id,
  'Graduation Order — ' || trim(s.first_name || ' ' || coalesce(s.last_name, '')),
  'Complete your senior graduation order, cap & gown sizing, and payment by the dues deadline.',
  'hub://graduation/' || s.id::text,
  'Graduation (Task)',
  ssy.school_year,
  gs.dues_due_date,
  false
FROM public.students s
JOIN public.student_school_years ssy
  ON ssy.student_id = s.id
 AND ssy.entry_type = 'current'
 AND ssy.semester_1_locked = true
JOIN public.graduation_settings gs ON gs.school_year = ssy.school_year
WHERE s.current_grade_level = '12'
  AND NOT EXISTS (
    SELECT 1 FROM public.family_documents fd
    WHERE fd.user_id = s.family_user_id
      AND fd.url = 'hub://graduation/' || s.id::text
      AND fd.category ILIKE '%task%'
  );