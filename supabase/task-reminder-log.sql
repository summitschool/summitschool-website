-- Tracks task reminder emails so each schedule slot fires only once per task.
-- Run once in Supabase SQL Editor before enabling the reminder cron.

CREATE TABLE IF NOT EXISTS public.task_reminder_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.family_documents(id) ON DELETE CASCADE,
  reminder_key text NOT NULL,
  recipient text NOT NULL DEFAULT '',
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, reminder_key)
);

CREATE INDEX IF NOT EXISTS task_reminder_sent_task_idx
  ON public.task_reminder_sent (task_id);

ALTER TABLE public.task_reminder_sent ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.task_reminder_sent IS
  'Dedupes Family Hub task reminder emails (family + admin) by task_id and reminder_key.';