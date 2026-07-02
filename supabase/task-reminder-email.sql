-- Daily task reminder emails (onboarding, progress reports, graduation).
--
-- SETUP:
-- 1. Run task-reminder-log.sql in SQL Editor.
-- 2. Deploy: supabase functions deploy notify-task-reminders --no-verify-jwt
-- 3. Secrets (Dashboard → Edge Functions → notify-task-reminders):
--      RESEND_API_KEY
--      APPROVAL_FROM_EMAIL
--      TASK_REMINDER_WEBHOOK_SECRET = long random string (same as step 4)
--      TASK_REMINDERS_LIVE = false   (set true after preview approval)
--      TASK_REMINDER_ADMIN_EMAIL = info@summitchurchschool.org  (optional override)
-- 4. Replace TASK_REMINDER_WEBHOOK_SECRET below, then run this SQL.
-- 5. Run task-reminder-cron.sql to schedule the daily job.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_task_reminders_email()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notify_url text := 'https://tajyrmydwqsijstyzsjr.supabase.co/functions/v1/notify-task-reminders';
  webhook_secret text := 'REPLACE_WITH_YOUR_TASK_REMINDER_WEBHOOK_SECRET';
BEGIN
  IF webhook_secret = 'REPLACE_WITH_YOUR_TASK_REMINDER_WEBHOOK_SECRET' THEN
    RAISE WARNING 'task-reminder-email.sql: set TASK_REMINDER_WEBHOOK_SECRET before expecting emails.';
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