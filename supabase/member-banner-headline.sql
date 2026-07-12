-- Custom headline for Family Hub announcement banners (default: Announcement)
-- Run once in Supabase SQL Editor.

ALTER TABLE public.member_banners
ADD COLUMN IF NOT EXISTS headline text NOT NULL DEFAULT 'Announcement';

UPDATE public.member_banners
SET headline = 'Announcement'
WHERE headline IS NULL OR btrim(headline) = '';