-- Google Sign-In support for Summit Family Hub
--
-- Run once in Supabase SQL Editor after enabling Google in Authentication → Providers.
-- Ensures every new auth user (email/password OR Google OAuth) gets a pending profiles row.
--
-- Google Cloud setup (one-time):
--   1. https://console.cloud.google.com/apis/credentials
--   2. Create OAuth client → Web application
--   3. Authorized JavaScript origins:
--        https://summitchurchschool.org
--        https://tajyrmydwqsijstyzsjr.supabase.co
--   4. Authorized redirect URIs:
--        https://tajyrmydwqsijstyzsjr.supabase.co/auth/v1/callback
--   5. Supabase Dashboard → Authentication → Providers → Google
--        paste Client ID + Client Secret, Save
--   6. Authentication → URL Configuration → Redirect URLs must include:
--        https://summitchurchschool.org/members.html?auth=oauth

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first text;
  v_last text;
  v_full text;
BEGIN
  v_first := coalesce(
    nullif(trim(NEW.raw_user_meta_data->>'first_name'), ''),
    nullif(trim(NEW.raw_user_meta_data->>'given_name'), '')
  );
  v_last := coalesce(
    nullif(trim(NEW.raw_user_meta_data->>'last_name'), ''),
    nullif(trim(NEW.raw_user_meta_data->>'family_name'), '')
  );
  v_full := coalesce(
    nullif(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(NEW.raw_user_meta_data->>'name'), ''),
    nullif(trim(concat_ws(' ', v_first, v_last)), '')
  );

  INSERT INTO public.profiles (id, email, first_name, last_name, full_name, approved, denied)
  VALUES (
    NEW.id,
    NEW.email,
    v_first,
    v_last,
    v_full,
    false,
    false
  )
  ON CONFLICT (id) DO UPDATE SET
    email = coalesce(EXCLUDED.email, profiles.email),
    first_name = coalesce(nullif(EXCLUDED.first_name, ''), profiles.first_name),
    last_name = coalesce(nullif(EXCLUDED.last_name, ''), profiles.last_name),
    full_name = coalesce(nullif(EXCLUDED.full_name, ''), profiles.full_name);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();