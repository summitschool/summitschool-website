-- Task due dates on family_documents (for My Tasks items).
-- Run once in Supabase SQL Editor.

ALTER TABLE public.family_documents
  ADD COLUMN IF NOT EXISTS due_date_1 date,
  ADD COLUMN IF NOT EXISTS due_date_2 date,
  ADD COLUMN IF NOT EXISTS due_date_1_cleared boolean NOT NULL DEFAULT false;