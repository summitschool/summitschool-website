-- Daily cron for task reminder emails.
-- Requires task-reminder-email.sql, task-reminder-log.sql, and pg_cron.
-- Schedule: 12:10 UTC daily (~7:10 AM US Eastern standard time).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'notify-task-reminders-daily';

SELECT cron.schedule(
  'notify-task-reminders-daily',
  '10 12 * * *',
  $$SELECT public.notify_task_reminders_email();$$
);