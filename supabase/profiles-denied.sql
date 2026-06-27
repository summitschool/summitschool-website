-- Add denied flag so admin can permanently hide rejected signups from the pending list.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS denied boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS profiles_pending_approval_idx
  ON public.profiles (approved, denied, created_at DESC);