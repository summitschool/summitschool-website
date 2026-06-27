-- Automatic Family Hub approval emails via Resend.
--
-- SETUP (one-time):
-- 1. Resend (https://resend.com):
--    - Add and verify domain: summitchurchschool.org
--    - Create an API key
-- 2. Deploy the Edge Function:
--      supabase functions deploy send-approval-email --no-verify-jwt
-- 3. Set Edge Function secrets (Dashboard → Edge Functions → send-approval-email → Secrets):
--      RESEND_API_KEY              = re_...
--      APPROVAL_EMAIL_WEBHOOK_SECRET = long random string (same value as step 4)
--      APPROVAL_FROM_EMAIL         = Summit Church School <info@summitchurchschool.org>
--      FAMILY_HUB_URL              = https://summitchurchschool.org/members.html
-- 4. Run this SQL AFTER replacing APPROVAL_WEBHOOK_SECRET below.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_approval_email(payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notify_url text := 'https://tajyrmydwqsijstyzsjr.supabase.co/functions/v1/send-approval-email';
  webhook_secret text := 'REPLACE_WITH_YOUR_APPROVAL_WEBHOOK_SECRET';
BEGIN
  IF webhook_secret = 'REPLACE_WITH_YOUR_APPROVAL_WEBHOOK_SECRET' THEN
    RAISE WARNING 'approval-email.sql: set APPROVAL_WEBHOOK_SECRET before expecting emails.';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := notify_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := payload
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.send_approval_email_on_approve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(OLD.approved, false) = true OR COALESCE(NEW.approved, false) <> true THEN
    RETURN NEW;
  END IF;

  IF NEW.email IS NULL OR btrim(NEW.email) = '' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.notify_approval_email(
      jsonb_build_object(
        'email', NEW.email,
        'first_name', NEW.first_name,
        'last_name', NEW.last_name,
        'full_name', NEW.full_name
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send_approval_email_on_approve failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS approval_email_on_profiles_update ON public.profiles;
CREATE TRIGGER approval_email_on_profiles_update
  AFTER UPDATE OF approved ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.send_approval_email_on_approve();