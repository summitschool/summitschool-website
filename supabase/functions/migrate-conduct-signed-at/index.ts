import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MIGRATION_SECRET = Deno.env.get('CONDUCT_MIGRATION_SECRET') || '';

const SIGNED_TITLE_PATTERNS = [
  '%2026 - 2027 scs code of conduct%',
  '%scs code of conduct%',
  '%code of conduct%',
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-migration-secret',
};

function isSignedConductTitle(title: string) {
  const normalized = String(title || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('driver') || normalized.includes('dmv') || normalized.includes('enrollment')) {
    return false;
  }
  return normalized.includes('scs code of conduct')
    || normalized.includes('code of conduct')
    || normalized.includes('conduct');
}

function isTaskCategory(category: string | null | undefined) {
  const normalized = String(category || '').toLowerCase();
  return normalized.includes('(task)') || normalized.includes('task');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  if (MIGRATION_SECRET) {
    const provided = req.headers.get('x-migration-secret') || '';
    if (provided !== MIGRATION_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date().toISOString();

  const { data: signedDocs, error: signedError } = await admin
    .from('family_documents')
    .select('id, user_id, title, category')
    .or(SIGNED_TITLE_PATTERNS.map((pattern) => `title.ilike.${pattern}`).join(','))
    .not('category', 'ilike', '%task%');

  if (signedError) {
    return new Response(JSON.stringify({ ok: false, error: signedError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const familyIds = [...new Set((signedDocs || [])
    .filter((doc) => isSignedConductTitle(doc.title) && !isTaskCategory(doc.category))
    .map((doc) => doc.user_id)
    .filter(Boolean))];

  let onboardingUpdated = 0;
  let tasksDeleted = 0;

  for (const familyUserId of familyIds) {
    const { data: onboarding } = await admin
      .from('family_onboarding')
      .select('manual_checks, conduct_signed_at')
      .eq('family_user_id', familyUserId)
      .maybeSingle();

    const manualChecks = onboarding?.manual_checks && typeof onboarding.manual_checks === 'object'
      ? onboarding.manual_checks as Record<string, unknown>
      : {};

    const upsertPayload: Record<string, unknown> = {
      family_user_id: familyUserId,
      manual_checks: { ...manualChecks, conduct: true },
    };

    if (!onboarding?.conduct_signed_at) {
      upsertPayload.conduct_signed_at = now;
    }

    const { error: upsertError } = await admin
      .from('family_onboarding')
      .upsert(upsertPayload, { onConflict: 'family_user_id' });

    if (!upsertError) {
      onboardingUpdated += 1;
    } else if (!String(upsertError.message).includes('conduct_signed_at')) {
      const { error: fallbackError } = await admin
        .from('family_onboarding')
        .upsert({
          family_user_id: familyUserId,
          manual_checks: { ...manualChecks, conduct: true },
        }, { onConflict: 'family_user_id' });
      if (!fallbackError) onboardingUpdated += 1;
    }

    const { data: cocTasks, error: taskError } = await admin
      .from('family_documents')
      .select('id, title, category')
      .eq('user_id', familyUserId)
      .ilike('title', '%code of conduct%')
      .ilike('category', '%task%');

    if (taskError) continue;

    const taskIds = (cocTasks || [])
      .filter((task) => isTaskCategory(task.category))
      .map((task) => task.id);

    if (!taskIds.length) continue;

    const { error: deleteError } = await admin
      .from('family_documents')
      .delete()
      .in('id', taskIds);

    if (!deleteError) tasksDeleted += taskIds.length;
  }

  return new Response(JSON.stringify({
    ok: true,
    families_with_signed_conduct: familyIds.length,
    onboarding_updated: onboardingUpdated,
    coc_tasks_deleted: tasksDeleted,
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});