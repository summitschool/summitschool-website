-- Daily cron for progress-report task visibility emails.
-- Requires task-visibility-email.sql and pg_cron (enabled on the project).
-- Schedule: 12:05 UTC daily (~7:05 AM US Eastern standard time).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'notify-task-visibility-daily';

SELECT cron.schedule(
  'notify-task-visibility-daily',
  '5 12 * * *',
  $$SELECT public.notify_task_visibility_email();$$
);