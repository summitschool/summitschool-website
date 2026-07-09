-- Server-side setup task assignment: bypasses client RLS and false conduct flags.
-- Run once in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.family_has_signed_code_of_conduct(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.family_documents fd
    WHERE fd.user_id = target_user_id
      AND COALESCE(fd.category, '') NOT ILIKE '%task%'
      AND COALESCE(fd.category, '') NOT ILIKE '%(task)%'
      AND fd.title NOT ILIKE '%enrollment%'
      AND COALESCE(fd.category, '') NOT ILIKE '%enrollment%'
      AND (
        fd.title ILIKE '%scs code of conduct%'
        OR fd.title ILIKE '%code of conduct%'
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_family_setup_tasks(target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text := coalesce(auth.jwt() ->> 'email', '');
  has_signed_coc boolean;
  manual_checks jsonb;
  coc_title text;
  coc_description text;
  coc_url text;
  coc_category text;
  school_year text := '2026-2027';
  missing text[] := ARRAY[]::text[];
  created_checklist boolean := false;
  created_coc boolean := false;
  cleared_false_conduct boolean := false;
BEGIN
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id is required';
  END IF;

  IF NOT (
    caller_email = 'sjesimon@gmail.com'
    OR public.staff_has_admin_section('members')
    OR public.staff_has_admin_section('families')
  ) THEN
    RAISE EXCEPTION 'Not authorized to assign family setup tasks';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = target_user_id
      AND p.approved = true
  ) THEN
    RAISE EXCEPTION 'Family is not approved';
  END IF;

  INSERT INTO public.family_onboarding (family_user_id)
  VALUES (target_user_id)
  ON CONFLICT (family_user_id) DO NOTHING;

  has_signed_coc := public.family_has_signed_code_of_conduct(target_user_id);

  SELECT COALESCE(fo.manual_checks, '{}'::jsonb)
  INTO manual_checks
  FROM public.family_onboarding fo
  WHERE fo.family_user_id = target_user_id;

  IF NOT has_signed_coc THEN
    UPDATE public.family_onboarding fo
    SET
      completed_at = NULL,
      conduct_signed_at = NULL,
      manual_checks = COALESCE(fo.manual_checks, '{}'::jsonb) || jsonb_build_object('conduct', false)
    WHERE fo.family_user_id = target_user_id
      AND (
        fo.conduct_signed_at IS NOT NULL
        OR coalesce((fo.manual_checks ->> 'conduct')::boolean, false)
        OR fo.completed_at IS NOT NULL
      );
    cleared_false_conduct := FOUND;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.family_documents fd
    WHERE fd.user_id = target_user_id
      AND fd.url = 'hub://onboarding'
      AND COALESCE(fd.category, '') ILIKE '%task%'
  ) THEN
    INSERT INTO public.family_documents (
      user_id, title, description, url, category, school_year, due_date_1, due_date_1_cleared
    ) VALUES (
      target_user_id,
      'Family Hub Setup Checklist',
      'Complete every step below, check off each item, then finish this checklist. Other required tasks stay in My Tasks until done.',
      'hub://onboarding',
      'Onboarding (Task)',
      school_year,
      (CURRENT_DATE + 14)::date,
      false
    );
    created_checklist := true;
  END IF;

  IF NOT has_signed_coc AND NOT EXISTS (
    SELECT 1
    FROM public.family_documents fd
    WHERE fd.user_id = target_user_id
      AND COALESCE(fd.category, '') ILIKE '%task%'
      AND (
        fd.title ILIKE '%code of conduct%'
        OR fd.url ILIKE '%3oBpb3Knk9GsNB%'
      )
  ) THEN
    SELECT
      COALESCE(std.title, 'Sign Code of Conduct (required)'),
      COALESCE(std.description, 'Read and sign the Summit Church School Code of Conduct.'),
      COALESCE(NULLIF(BTRIM(std.url), ''), 'https://enroll.summitchurchschool.org/d/3oBpb3Knk9GsNB'),
      COALESCE(std.category, 'Policy') || ' (Task)'
    INTO coc_title, coc_description, coc_url, coc_category
    FROM (
      SELECT title, description, url, category
      FROM public.standard_documents
      WHERE title ILIKE '%code of conduct%'
      ORDER BY created_at DESC NULLS LAST
      LIMIT 1
    ) std;

    INSERT INTO public.family_documents (
      user_id, title, description, url, category, school_year, due_date_1, due_date_1_cleared
    ) VALUES (
      target_user_id,
      coc_title,
      coc_description,
      coc_url,
      coc_category,
      school_year,
      (CURRENT_DATE + 14)::date,
      false
    );
    created_coc := true;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.family_documents fd
    WHERE fd.user_id = target_user_id
      AND fd.url = 'hub://onboarding'
      AND COALESCE(fd.category, '') ILIKE '%task%'
  ) THEN
    missing := array_append(missing, 'Family Hub Setup Checklist');
  END IF;

  IF NOT has_signed_coc AND NOT EXISTS (
    SELECT 1
    FROM public.family_documents fd
    WHERE fd.user_id = target_user_id
      AND COALESCE(fd.category, '') ILIKE '%task%'
      AND (
        fd.title ILIKE '%code of conduct%'
        OR fd.url ILIKE '%3oBpb3Knk9GsNB%'
      )
  ) THEN
    missing := array_append(missing, COALESCE(coc_title, '2026-2027 Code of Conduct'));
  END IF;

  RETURN jsonb_build_object(
    'ok', cardinality(missing) = 0,
    'has_signed_coc', has_signed_coc,
    'cleared_false_conduct', cleared_false_conduct,
    'created_checklist', created_checklist,
    'created_coc', created_coc,
    'missing', to_jsonb(missing)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_family_setup_tasks(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_assign_family_setup_tasks(uuid) TO authenticated;