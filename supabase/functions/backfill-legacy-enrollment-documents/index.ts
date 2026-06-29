import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { archiveEnrollmentSubmissionToHub } from '../_shared/archive-enrollment-to-hub.ts';
import { deliverPendingEnrollmentDocuments } from '../_shared/deliver-pending-enrollment-documents.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const WEBHOOK_SECRET = Deno.env.get('ENROLLMENT_BACKFILL_WEBHOOK_SECRET')
  || Deno.env.get('ENROLLMENT_DELIVERY_WEBHOOK_SECRET')
  || Deno.env.get('APPROVAL_EMAIL_WEBHOOK_SECRET');

const DOCUSEAL_API_URL = (Deno.env.get('DOCUSEAL_API_URL') || 'https://enroll.summitchurchschool.org').replace(/\/$/, '');
const DOCUSEAL_API_KEY = Deno.env.get('DOCUSEAL_API_KEY') || '';
const SIGNATURE_ADMIN_EMAIL = (Deno.env.get('ENROLLMENT_SIGNATURE_EMAIL') || 'info@summitchurchschool.org').toLowerCase();

const DEFAULT_LEGACY_SLUG = 'hepTZVXKSzmTVE';
const ENROLLMENT_ARCHIVE_SCHOOL_YEAR = Deno.env.get('DOCUSEAL_ENROLLMENT_ARCHIVE_SCHOOL_YEAR') || '2026-2027';
const ENROLLMENT_ARCHIVE_CATEGORY = Deno.env.get('DOCUSEAL_ENROLLMENT_ARCHIVE_CATEGORY') || 'Enrollment';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type DocuSealSubmitter = {
  email?: string;
  name?: string | null;
  status?: string;
  role?: string;
};

type DocuSealSubmission = {
  id: number;
  status?: string;
  submitters?: DocuSealSubmitter[];
  template?: {
    id?: number;
    name?: string;
    slug?: string;
  };
};

type DocuSealTemplate = {
  id: number;
  slug?: string;
  name?: string;
};

type BackfillPayload = {
  template_slug?: string;
  dry_run?: boolean;
};

async function isAuthorized(req: Request) {
  if (WEBHOOK_SECRET) {
    return req.headers.get('x-webhook-secret') === WEBHOOK_SECRET;
  }
  return false;
}

async function fetchTemplateBySlug(slug: string) {
  const response = await fetch(`${DOCUSEAL_API_URL}/api/templates?limit=100`, {
    headers: {
      'X-Auth-Token': DOCUSEAL_API_KEY,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`DocuSeal template lookup failed (${response.status}): ${await response.text()}`);
  }

  const body = await response.json() as { data?: DocuSealTemplate[] };
  const template = (body.data || []).find((entry) => entry.slug === slug);
  if (!template?.id) {
    throw new Error(`DocuSeal template not found for slug ${slug}`);
  }

  return template;
}

async function fetchCompletedSubmissions(templateId: number) {
  const submissions: DocuSealSubmission[] = [];
  let after: number | undefined;

  while (true) {
    const params = new URLSearchParams({
      template_id: String(templateId),
      status: 'completed',
      limit: '100',
    });
    if (after) params.set('after', String(after));

    const response = await fetch(`${DOCUSEAL_API_URL}/api/submissions?${params.toString()}`, {
      headers: {
        'X-Auth-Token': DOCUSEAL_API_KEY,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`DocuSeal submissions lookup failed (${response.status}): ${await response.text()}`);
    }

    const body = await response.json() as {
      data?: DocuSealSubmission[];
      pagination?: { next?: number | null };
    };

    const batch = body.data || [];
    submissions.push(...batch);

    const next = body.pagination?.next;
    if (!next || batch.length === 0) break;
    after = next;
  }

  return submissions;
}

function resolveFamilyContact(submission: DocuSealSubmission) {
  const adminEmails = new Set([SIGNATURE_ADMIN_EMAIL]);
  const familySubmitter = (submission.submitters || []).find((submitter) => {
    const email = String(submitter.email || '').trim().toLowerCase();
    return email && !adminEmails.has(email);
  });

  if (!familySubmitter?.email) return null;

  return {
    email: String(familySubmitter.email).trim().toLowerCase(),
    name: String(familySubmitter.name || '').trim(),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  if (!(await isAuthorized(req))) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Unauthorized webhook',
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!DOCUSEAL_API_KEY) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'DOCUSEAL_API_KEY must be set',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload = await req.json().catch(() => ({})) as BackfillPayload;
    const templateSlug = String(payload.template_slug || DEFAULT_LEGACY_SLUG).trim();
    const dryRun = payload.dry_run === true;

    const template = await fetchTemplateBySlug(templateSlug);
    const submissions = await fetchCompletedSubmissions(template.id);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const results: Array<Record<string, unknown>> = [];
    const emailsToDeliver = new Set<string>();

    for (const submission of submissions) {
      if (String(submission.status || '').toLowerCase() !== 'completed') {
        results.push({
          submission_id: submission.id,
          skipped: 'submission_not_completed',
        });
        continue;
      }

      const family = resolveFamilyContact(submission);
      if (!family) {
        results.push({
          submission_id: submission.id,
          skipped: 'family_email_not_found',
        });
        continue;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, email, approved, denied')
        .ilike('email', family.email)
        .maybeSingle();

      const entry: Record<string, unknown> = {
        submission_id: submission.id,
        family_email: family.email,
        family_name: family.name || null,
        template_slug: templateSlug,
        template_name: template.name || 'Enrollment Application',
        profile_found: Boolean(profile?.id),
        profile_approved: profile?.approved === true,
        profile_denied: profile?.denied === true,
      };

      if (dryRun) {
        entry.action = 'dry_run';
        results.push(entry);
        continue;
      }

      try {
        const archiveResult = await archiveEnrollmentSubmissionToHub({
          supabaseUrl: SUPABASE_URL,
          supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
          submissionId: submission.id,
          templateId: template.id,
          templateName: template.name || 'Enrollment Application',
          familyEmail: family.email,
          familyName: family.name,
          docusealApiUrl: DOCUSEAL_API_URL,
          docusealApiKey: DOCUSEAL_API_KEY,
          schoolYear: ENROLLMENT_ARCHIVE_SCHOOL_YEAR,
          category: ENROLLMENT_ARCHIVE_CATEGORY,
        });

        entry.archive = archiveResult;
        emailsToDeliver.add(family.email);
        results.push(entry);
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
        results.push(entry);
      }
    }

    const deliveryResults: Array<Record<string, unknown>> = [];
    if (!dryRun) {
      for (const email of emailsToDeliver) {
        try {
          const delivery = await deliverPendingEnrollmentDocuments({
            supabaseUrl: SUPABASE_URL,
            supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
            familyEmail: email,
          });
          deliveryResults.push({ email, ...delivery });
        } catch (error) {
          deliveryResults.push({
            email,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      template_slug: templateSlug,
      template_id: template.id,
      template_name: template.name,
      dry_run: dryRun,
      submission_count: submissions.length,
      processed_count: results.length,
      results,
      delivery_results: deliveryResults,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('backfill-legacy-enrollment-documents error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});