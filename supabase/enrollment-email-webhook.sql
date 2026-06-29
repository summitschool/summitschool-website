-- Enrollment application emails via DocuSeal webhook + Resend.
-- Only submissions from templates listed in DOCUSEAL_ENROLLMENT_TEMPLATE_IDS
-- or DOCUSEAL_ENROLLMENT_TEMPLATE_SLUGS are emailed by the Edge Function.
--
-- SETUP (one-time):
-- 1. Run this SQL in the Supabase SQL editor.
-- 2. Deploy the Edge Function:
--      supabase functions deploy docuseal-enrollment-webhook --no-verify-jwt
-- 3. Set Edge Function secrets (Dashboard → Edge Functions → docuseal-enrollment-webhook → Secrets):
--      RESEND_API_KEY                       = re_...
--      APPROVAL_FROM_EMAIL                  = Summit Church School <info@summitchurchschool.org>
--      FULL_ADMIN_EMAIL                     = sjesimon@gmail.com
--      ENROLLMENT_SIGNATURE_EMAIL           = info@summitchurchschool.org
--      DOCUSEAL_ENROLLMENT_WEBHOOK_SECRET   = long random string (same value used in DocuSeal webhook URL/header)
--      DOCUSEAL_ENROLLMENT_TEMPLATE_SLUGS    = vi3n5SzMfFnRLH
--      DOCUSEAL_ENROLLMENT_TEMPLATE_IDS     = optional comma-separated numeric template IDs
--      DOCUSEAL_API_URL                     = https://enroll.summitchurchschool.org
--      DOCUSEAL_API_KEY                     = DocuSeal API key (used to resolve template slugs to IDs)
--      DOCUSEAL_WEBHOOK_HMAC_SECRET         = optional whsec_... value from DocuSeal webhook Security → HMAC
-- 4. In DocuSeal → Webhooks → New Webhook:
--      URL: https://tajyrmydwqsijstyzsjr.supabase.co/functions/v1/docuseal-enrollment-webhook
--      Event: form.completed
--      Security header (optional): x-webhook-secret = your DOCUSEAL_ENROLLMENT_WEBHOOK_SECRET
-- 5. On the enrollment template only (vi3n5SzMfFnRLH):
--      - Set completion redirect to https://summitchurchschool.org/enrollment-complete.html
--      - Turn OFF built-in Documents Copy / Completed Notification emails
--      - Leave other DocuSeal forms unchanged

CREATE TABLE IF NOT EXISTS public.enrollment_email_log (
  submission_id bigint PRIMARY KEY,
  template_id bigint,
  family_email text,
  family_name text,
  admin_pending_notified_at timestamptz,
  family_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.enrollment_email_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.enrollment_email_log IS
  'Tracks enrollment DocuSeal webhook emails: admin signature request after family submits, family next-steps after admin signs.';