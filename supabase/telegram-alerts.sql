-- Telegram alerts for pending member approvals and pending ID uploads.
--
-- SETUP (one-time):
-- 1. In Telegram, message @BotFather → /newbot → save the bot token.
-- 2. Message your new bot once, then open:
--      https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
--    Copy your chat "id" (personal chat or group).
-- 3. Deploy the Edge Function from this repo:
--      supabase functions deploy telegram-notify
-- 4. Set Edge Function secrets (Supabase Dashboard → Edge Functions → telegram-notify → Secrets):
--      TELEGRAM_BOT_TOKEN = your bot token
--      TELEGRAM_CHAT_ID   = your chat id
--      TELEGRAM_WEBHOOK_SECRET = long random string (same value as step 5)
-- 5. Run this SQL in Supabase SQL Editor AFTER replacing the two placeholders below.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── Replace these before running ─────────────────────────────────────────────
-- NOTIFY_FUNCTION_URL: https://<project-ref>.supabase.co/functions/v1/telegram-notify
-- NOTIFY_WEBHOOK_SECRET: same random string as TELEGRAM_WEBHOOK_SECRET on the function

CREATE OR REPLACE FUNCTION public.notify_telegram_alert(alert_type text, payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notify_url text := 'https://tajyrmydwqsijstyzsjr.supabase.co/functions/v1/telegram-notify';
  webhook_secret text := 'REPLACE_WITH_YOUR_WEBHOOK_SECRET';
BEGIN
  IF webhook_secret = 'REPLACE_WITH_YOUR_WEBHOOK_SECRET' THEN
    RAISE WARNING 'telegram-alerts.sql: set NOTIFY_WEBHOOK_SECRET before expecting alerts.';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := notify_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'type', alert_type,
      'record', payload
    )
  );
END;
$$;

-- Optional helper table for id_uploads if you have not created it yet.
CREATE TABLE IF NOT EXISTS public.id_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ack_name text,
  storage_path text NOT NULL,
  school_year text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS id_uploads_status_created_idx
  ON public.id_uploads (status, created_at DESC);

-- New family signup waiting for approval
CREATE OR REPLACE FUNCTION public.telegram_notify_pending_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.approved, false) = true OR COALESCE(NEW.denied, false) = true THEN
    RETURN NEW;
  END IF;

  PERFORM public.notify_telegram_alert(
    'member_approval',
    jsonb_build_object(
      'id', NEW.id,
      'first_name', NEW.first_name,
      'last_name', NEW.last_name,
      'full_name', NEW.full_name,
      'email', NEW.email,
      'created_at', NEW.created_at
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS telegram_pending_member_insert ON public.profiles;
CREATE TRIGGER telegram_pending_member_insert
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.telegram_notify_pending_member();

-- Pending government ID upload
CREATE OR REPLACE FUNCTION public.telegram_notify_pending_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.status, 'pending') <> 'pending' THEN
    RETURN NEW;
  END IF;

  PERFORM public.notify_telegram_alert(
    'id_approval',
    jsonb_build_object(
      'id', NEW.id,
      'user_id', NEW.user_id,
      'ack_name', NEW.ack_name,
      'storage_path', NEW.storage_path,
      'school_year', NEW.school_year,
      'created_at', NEW.created_at
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS telegram_pending_id_insert ON public.id_uploads;
CREATE TRIGGER telegram_pending_id_insert
  AFTER INSERT ON public.id_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.telegram_notify_pending_id();