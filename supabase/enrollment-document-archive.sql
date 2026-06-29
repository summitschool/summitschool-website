-- Enrollment signed PDF → Family Hub My Documents (immediate or queued until signup).
--
-- SETUP (one-time):
-- 1. Run this SQL in the Supabase SQL editor.
-- 2. Run enrollment-pending-delivery.sql (deliver queued docs on new profile).
-- 3. Deploy Edge Functions:
--      supabase functions deploy docuseal-enrollment-webhook --no-verify-jwt
--      supabase functions deploy deliver-pending-enrollment-documents --no-verify-jwt
-- 4. Secrets on docuseal-enrollment-webhook (existing + optional):
--      DOCUSEAL_ENROLLMENT_ARCHIVE_SCHOOL_YEAR  = optional, default 2026-2027
--      DOCUSEAL_ENROLLMENT_ARCHIVE_CATEGORY     = optional, default Enrollment
--      DOCUSEAL_API_KEY                         = required (download signed PDF)
-- 5. Secrets on deliver-pending-enrollment-documents:
--      ENROLLMENT_DELIVERY_WEBHOOK_SECRET       = long random string (same as SQL below)

CREATE TABLE IF NOT EXISTS public.enrollment_document_archive (
  submission_id bigint PRIMARY KEY,
  template_id bigint,
  family_email text NOT NULL,
  family_name text,
  title text NOT NULL,
  school_year text NOT NULL DEFAULT '2026-2027',
  category text NOT NULL DEFAULT 'Enrollment',
  storage_path text NOT NULL DEFAULT 'pending',
  family_user_id uuid,
  family_document_id uuid,
  archived_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  processing_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS enrollment_document_archive_pending_email_idx
  ON public.enrollment_document_archive (lower(family_email))
  WHERE delivered_at IS NULL;

ALTER TABLE public.enrollment_document_archive ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.enrollment_document_archive IS
  'Tracks fully signed enrollment PDFs. Delivered to family_documents when profile exists or after Hub signup.';