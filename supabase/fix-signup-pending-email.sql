-- Fix inverted webhook-secret guard that prevented all pending signup emails.
-- Run with your real webhook secret substituted for REPLACE_WITH_SIGNUP_PENDING_WEBHOOK_SECRET.

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
    RAISE WARNING 'notify_signup_pending_email: webhook secret not configured.';
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