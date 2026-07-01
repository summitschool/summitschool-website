-- Graduation settings v2: event times/locations, requirements, honor cord list.
-- Run once in Supabase SQL Editor (safe to re-run).

ALTER TABLE public.graduation_settings
  ADD COLUMN IF NOT EXISTS ceremony_time text,
  ADD COLUMN IF NOT EXISTS ceremony_location text,
  ADD COLUMN IF NOT EXISTS practice_time text,
  ADD COLUMN IF NOT EXISTS practice_location text,
  ADD COLUMN IF NOT EXISTS pictures_time text,
  ADD COLUMN IF NOT EXISTS pictures_location text,
  ADD COLUMN IF NOT EXISTS requirements_text text,
  ADD COLUMN IF NOT EXISTS honor_cord_options text;

UPDATE public.graduation_settings
SET
  ceremony_time = COALESCE(ceremony_time, '6:00 PM'),
  ceremony_location = COALESCE(ceremony_location, 'Summit Church School — main auditorium'),
  practice_time = COALESCE(practice_time, '6:00 PM'),
  practice_location = COALESCE(practice_location, 'Summit Church School — main auditorium'),
  pictures_time = COALESCE(pictures_time, 'TBA'),
  pictures_location = COALESCE(pictures_location, 'TBA'),
  honor_cord_options = COALESCE(honor_cord_options, E'National Honor Society\nBeta Club\nMu Eta Sigma (Math Honor Society)\nPresidential Academic Excellence\nSubject-area honor cord'),
  requirements_text = COALESCE(requirements_text, E'Summit Church School Senior Graduation Requirements\n\n• The graduate must meet all SCS graduation credit and attendance requirements.\n• Graduation fees must be paid by the dues deadline shown above.\n• Students participating in the ceremony must attend the mandatory practice the night before.\n• Cap and gown are required at practice and at the ceremony.\n• Students and families are expected to conduct themselves respectfully at all graduation events.\n• Guest tickets or seating policies communicated by the school must be followed.\n• Summit Church School reserves the right to withhold participation for outstanding balances or behavioral concerns.\n\nBy signing below, the parent/guardian acknowledges these requirements and confirms the order information is accurate.')
WHERE school_year = '2026-2027';