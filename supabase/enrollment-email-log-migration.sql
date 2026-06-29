-- Run in Supabase SQL editor if you already created enrollment_email_log from the first version.

ALTER TABLE public.enrollment_email_log
  ADD COLUMN IF NOT EXISTS family_email text,
  ADD COLUMN IF NOT EXISTS family_name text,
  ADD COLUMN IF NOT EXISTS admin_pending_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS family_notified_at timestamptz;

COMMENT ON TABLE public.enrollment_email_log IS
  'Tracks enrollment DocuSeal webhook emails: admin signature request after family submits, family next-steps after admin signs.';