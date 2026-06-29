-- Hub archive forms: signed PDF → Family Hub My Documents, task removed, thank-you redirect.
-- Single-signer forms (e.g. 3oBpb3Knk9GsNB) with no countersignature.
--
-- SETUP (one-time):
-- 1. Run this SQL in the Supabase SQL editor.
-- 2. Deploy the Edge Function:
--      supabase functions deploy docuseal-hub-archive-webhook --no-verify-jwt
-- 3. Set Edge Function secrets (Dashboard → Edge Functions → docuseal-hub-archive-webhook → Secrets):
--      DOCUSEAL_HUB_ARCHIVE_WEBHOOK_SECRET    = long random string (or reuse DOCUSEAL_ENROLLMENT_WEBHOOK_SECRET)
--      DOCUSEAL_HUB_ARCHIVE_TEMPLATE_SLUGS    = 3oBpb3Knk9GsNB
--      DOCUSEAL_HUB_ARCHIVE_TEMPLATE_IDS      = optional comma-separated numeric template IDs
--      DOCUSEAL_HUB_ARCHIVE_SCHOOL_YEAR       = optional, default 2026-2027
--      DOCUSEAL_HUB_ARCHIVE_CATEGORY          = optional, default Signed Form
--      DOCUSEAL_API_URL                       = https://enroll.summitchurchschool.org
--      DOCUSEAL_API_KEY                       = required (download signed PDF)
--      DOCUSEAL_WEBHOOK_HMAC_SECRET           = optional whsec_... from DocuSeal webhook Security → HMAC
-- 4. In DocuSeal → Webhooks → New Webhook:
--      URL: https://tajyrmydwqsijstyzsjr.supabase.co/functions/v1/docuseal-hub-archive-webhook
--      Events: submission.created AND form.completed
--      Security header (optional): x-webhook-secret = your DOCUSEAL_HUB_ARCHIVE_WEBHOOK_SECRET
-- 5. On this template only (3oBpb3Knk9GsNB):
--      - Turn OFF built-in Documents Copy / Completed Notification emails
--      - Completion redirect (optional): https://summitchurchschool.org/hub-form-complete.html?template=3oBpb3Knk9GsNB
--        submission.created webhook sets this automatically on the submitter

CREATE TABLE IF NOT EXISTS public.hub_form_archive_log (
  submission_id bigint PRIMARY KEY,
  template_id bigint,
  family_email text,
  family_user_id uuid,
  storage_path text,
  family_document_id uuid,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hub_form_archive_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.hub_form_archive_log IS
  'Tracks DocuSeal forms archived to Family Hub My Documents after single-signer completion.';