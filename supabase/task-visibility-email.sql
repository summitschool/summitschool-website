-- Daily progress-report task visibility emails (Dec 1 / May 1 windows).
--
-- SETUP:
-- 1. Deploy: supabase functions deploy notify-task-visibility --no-verify-jwt
-- 2. Secrets (Dashboard → Edge Functions → notify-task-visibility):
--      RESEND_API_KEY
--      APPROVAL_FROM_EMAIL
--      TASK_VISIBILITY_WEBHOOK_SECRET = long random string (same as step 3)
-- 3. Replace TASK_VISIBILITY_WEBHOOK_SECRET below, then run this SQL.
-- 4. Schedule in Supabase Dashboard → Database → Cron (or pg_cron):
--      5 12 * * *  — daily at 12:05 UTC (~7:05 AM Eastern standard)
--      SELECT public.notify_task_visibility_email();

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_task_visibility_email()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notify_url text := 'https://tajyrmydwqsijstyzsjr.supabase.co/functions/v1/notify-task-visibility';
  webhook_secret text := 'REPLACE_WITH_YOUR_TASK_VISIBILITY_WEBHOOK_SECRET';
BEGIN
  IF webhook_secret = 'REPLACE_WITH_YOUR_TASK_VISIBILITY_WEBHOOK_SECRET' THEN
    RAISE WARNING 'task-visibility-email.sql: set TASK_VISIBILITY_WEBHOOK_SECRET before expecting emails.';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := notify_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object('action', 'scan')
  );
END;
$$;