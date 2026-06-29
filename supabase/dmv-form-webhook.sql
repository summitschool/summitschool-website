-- DMV / driver education form via DocuSeal webhook.
-- Single-signer form (vfjkLH3hKczzX9): thank-you redirect, signed PDF → My Documents,
-- matching My Tasks row removed. Resources tab (shared_resources) is unchanged.
--
-- SETUP (one-time):
-- 1. Run hub-form-archive-webhook.sql first (hub_form_archive_log table).
-- 2. Deploy the Edge Function:
--      supabase functions deploy docuseal-dmv-webhook --no-verify-jwt
-- 3. Set Edge Function secrets (Dashboard → Edge Functions → docuseal-dmv-webhook → Secrets):
--      DOCUSEAL_DMV_WEBHOOK_SECRET       = long random string (or reuse DOCUSEAL_ENROLLMENT_WEBHOOK_SECRET)
--      DOCUSEAL_DMV_TEMPLATE_SLUGS       = vfjkLH3hKczzX9
--      DOCUSEAL_DMV_TEMPLATE_IDS         = optional comma-separated numeric template IDs
--      DOCUSEAL_DMV_ARCHIVE_SCHOOL_YEAR  = optional, default 2026-2027
--      DOCUSEAL_DMV_ARCHIVE_CATEGORY     = optional, default Signed Form
--      DOCUSEAL_API_URL                  = https://enroll.summitchurchschool.org
--      DOCUSEAL_API_KEY                  = DocuSeal API key (required for PDF download)
--      DOCUSEAL_WEBHOOK_HMAC_SECRET      = optional whsec_... value from DocuSeal webhook Security → HMAC
-- 4. In DocuSeal → Webhooks → New Webhook:
--      URL: https://tajyrmydwqsijstyzsjr.supabase.co/functions/v1/docuseal-dmv-webhook
--      Events: submission.created AND form.completed
--      Security header (optional): x-webhook-secret = your DOCUSEAL_DMV_WEBHOOK_SECRET
-- 5. On the DMV form template only (vfjkLH3hKczzX9):
--      - Set completion redirect to https://summitchurchschool.org/dmv-permit-form-complete.html?template=vfjkLH3hKczzX9
--        (submission.created webhook also sets this automatically)
--      - Turn OFF built-in Documents Copy / Completed Notification emails
--      - Leave enrollment and other DocuSeal forms unchanged

CREATE TABLE IF NOT EXISTS public.dmv_email_log (
  submission_id bigint PRIMARY KEY,
  template_id bigint,
  family_email text,
  family_name text,
  family_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dmv_email_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.dmv_email_log IS
  'Legacy DMV webhook log from the email-attachment flow. New completions use hub_form_archive_log.';