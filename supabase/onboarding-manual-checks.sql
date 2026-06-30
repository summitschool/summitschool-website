-- Manual checklist box state for Family Hub onboarding (run once in Supabase SQL Editor)
ALTER TABLE public.family_onboarding
  ADD COLUMN IF NOT EXISTS manual_checks jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.family_onboarding.manual_checks IS
  'Parent-checked boxes on the setup checklist, e.g. {"students":true,"conduct":true}';