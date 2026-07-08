-- Block re-inserting Code of Conduct tasks for families who already signed.
-- Protects families on stale mobile browser caches until fresh JS loads.

CREATE OR REPLACE FUNCTION public.prevent_duplicate_coc_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_coc_task boolean;
BEGIN
  is_coc_task := COALESCE(NEW.title, '') ILIKE '%code of conduct%'
    AND (
      COALESCE(NEW.category, '') ILIKE '%(task)%'
      OR COALESCE(NEW.category, '') ILIKE '%task%'
    );

  IF NOT is_coc_task THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM family_onboarding fo
    WHERE fo.family_user_id = NEW.user_id
      AND fo.conduct_signed_at IS NOT NULL
  ) THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM family_documents fd
    WHERE fd.user_id = NEW.user_id
      AND fd.id IS DISTINCT FROM NEW.id
      AND (
        fd.title ILIKE '%2026 - 2027 scs code of conduct%'
        OR fd.title ILIKE '%scs code of conduct%'
        OR (
          fd.title ILIKE '%code of conduct%'
          AND COALESCE(fd.category, '') NOT ILIKE '%task%'
          AND COALESCE(fd.category, '') NOT ILIKE '%(task)%'
        )
      )
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_duplicate_coc_task ON family_documents;
CREATE TRIGGER prevent_duplicate_coc_task
  BEFORE INSERT ON family_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_coc_task();