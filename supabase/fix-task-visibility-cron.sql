-- Fix notify_task_visibility_email() early-return bug.
-- The placeholder guard was accidentally updated to match the real secret,
-- so the cron job never called the edge function.
-- Run once in Supabase SQL Editor (or via ./supabase/run-sql.sh).

CREATE OR REPLACE FUNCTION public.notify_task_visibility_email()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notify_url text := 'https://tajyrmydwqsijstyzsjr.supabase.co/functions/v1/notify-task-visibility';
  webhook_secret text := 'a9792d2fbdf2a42a7c2e2ea73cc4239a8eb01f51fe372a20a6af5ec44181aef5';
BEGIN
  IF webhook_secret IS NULL
     OR btrim(webhook_secret) = ''
     OR webhook_secret = 'REPLACE_WITH_YOUR_TASK_VISIBILITY_WEBHOOK_SECRET' THEN
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