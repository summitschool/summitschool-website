-- Deliver queued enrollment PDFs when a new Family Hub profile is created (signup).
-- Replace ENROLLMENT_DELIVERY_WEBHOOK_SECRET below, then run after enrollment-document-archive.sql.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_enrollment_document_delivery(payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notify_url text := 'https://tajyrmydwqsijstyzsjr.supabase.co/functions/v1/deliver-pending-enrollment-documents';
  webhook_secret text := 'ec3074dc1ef510224d294f110af36dc7e5199f1f5bca435fbd1ec6e53e9a764b';
BEGIN
  IF webhook_secret = '' THEN
    RAISE WARNING 'enrollment-pending-delivery.sql: set ENROLLMENT_DELIVERY_WEBHOOK_SECRET before expecting delivery.';
    RETURN;
  END IF;

  IF COALESCE(payload->>'email', '') = '' THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := notify_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := payload
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enrollment_delivery_on_profiles_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.email, '') = '' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.notify_enrollment_document_delivery(
      jsonb_build_object(
        'email', NEW.email,
        'user_id', NEW.id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enrollment_delivery_on_profiles_insert failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enrollment_delivery_profiles_insert ON public.profiles;
CREATE TRIGGER enrollment_delivery_profiles_insert
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enrollment_delivery_on_profiles_insert();