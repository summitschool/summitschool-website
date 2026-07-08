-- Track why an ID submission was denied and when.

ALTER TABLE public.id_uploads
  ADD COLUMN IF NOT EXISTS denial_reason text,
  ADD COLUMN IF NOT EXISTS denied_at timestamptz;

CREATE INDEX IF NOT EXISTS id_uploads_denied_user_idx
  ON public.id_uploads (user_id, denied_at DESC)
  WHERE status = 'denied';