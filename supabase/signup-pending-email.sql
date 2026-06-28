-- Send a branded "pending approval" email when a new Family Hub profile is created.
-- Covers Google OAuth and email/password signups (Google users do not get Supabase confirm emails).
--
-- SETUP:
-- 1. Deploy: supabase functions deploy send-signup-pending-email --no-verify-jwt
-- 2. Set Edge Function secrets (reuse Resend + webhook secret from send-approval-email):
--      RESEND_API_KEY
--      APPROVAL_FROM_EMAIL
--      APPROVAL_EMAIL_WEBHOOK_SECRET   (or SIGNUP_PENDING_EMAIL_WEBHOOK_SECRET)
-- 3. Replace SIGNUP_PENDING_WEBHOOK_SECRET below, then run this SQL.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_signup_pending_email(payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notify_url text := 'https://tajyrmydwqsijstyzsjr.supabase.co/functions/v1/send-signup-pending-email';
  webhook_secret text := 'REPLACE_WITH_SIGNUP_PENDING_WEBHOOK_SECRET';
BEGIN
  IF webhook_secret = 'REPLACE_WITH_SIGNUP_PENDING_WEBHOOK_SECRET' THEN
    RAISE WARNING 'signup-pending-email.sql: set SIGNUP_PENDING_WEBHOOK_SECRET before expecting emails.';
    RETURN;
  END IF;

  IF COALESCE(payload->>'email', '') = '' THEN
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

CREATE OR REPLACE FUNCTION public.signup_pending_email_on_profiles_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.approved, false) = true THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.email, '') = '' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.notify_signup_pending_email(
      jsonb_build_object(
        'email', NEW.email,
        'first_name', NEW.first_name,
        'last_name', NEW.last_name,
        'full_name', NEW.full_name
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'signup_pending_email_on_profiles_insert failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS signup_pending_email_profiles_insert ON public.profiles;
CREATE TRIGGER signup_pending_email_profiles_insert
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.signup_pending_email_on_profiles_insert();