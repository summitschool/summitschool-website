-- DMV / driver education form emails via DocuSeal webhook + Resend.
-- Single-signer form (vfjkLH3hKczzX9): thank-you redirect + signed PDF emailed to family.
--
-- SETUP (one-time):
-- 1. Run this SQL in the Supabase SQL editor.
-- 2. Deploy the Edge Function:
--      supabase functions deploy docuseal-dmv-webhook --no-verify-jwt
-- 3. Set Edge Function secrets (Dashboard → Edge Functions → docuseal-dmv-webhook → Secrets):
--      RESEND_API_KEY                    = re_...
--      APPROVAL_FROM_EMAIL               = Summit Church School <info@summitchurchschool.org>
--      DOCUSEAL_DMV_WEBHOOK_SECRET       = long random string (or reuse DOCUSEAL_ENROLLMENT_WEBHOOK_SECRET)
--      DOCUSEAL_DMV_TEMPLATE_SLUGS       = vfjkLH3hKczzX9
--      DOCUSEAL_DMV_TEMPLATE_IDS         = optional comma-separated numeric template IDs
--      DOCUSEAL_API_URL                  = https://enroll.summitchurchschool.org
--      DOCUSEAL_API_KEY                  = DocuSeal API key (required for PDF download)
--      DOCUSEAL_WEBHOOK_HMAC_SECRET      = optional whsec_... value from DocuSeal webhook Security → HMAC
-- 4. In DocuSeal → Webhooks → New Webhook:
--      URL: https://tajyrmydwqsijstyzsjr.supabase.co/functions/v1/docuseal-dmv-webhook
--      Events: submission.created AND form.completed
--      Security header (optional): x-webhook-secret = your DOCUSEAL_DMV_WEBHOOK_SECRET
-- 5. On the DMV form template only (vfjkLH3hKczzX9):
--      - Set completion redirect to https://summitchurchschool.org/dmv-permit-form-complete.html
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
  'Tracks DMV driver education DocuSeal webhook emails with signed PDF attachments.';