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
  action?: 'backfill' | 'survey' | 'cleanup';
  template_slug?: string;
  dry_run?: boolean;
  emails?: string[];
};

const STORAGE_BUCKET = 'Family-Documents';

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

async function fetchSubmissionsForEmail(templateId: number, email: string) {
  const submissions: DocuSealSubmission[] = [];
  let after: number | undefined;

  while (true) {
    const params = new URLSearchParams({
      template_id: String(templateId),
      q: email,
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

async function cleanupEnrollmentEmails(
  supabase: ReturnType<typeof createClient>,
  emails: string[],
  dryRun: boolean,
) {
  const normalized = emails.map((email) => email.trim().toLowerCase()).filter(Boolean);
  const results: Array<Record<string, unknown>> = [];

  for (const email of normalized) {
    const { data: archiveRows, error: archiveError } = await supabase
      .from('enrollment_document_archive')
      .select('submission_id, storage_path, family_document_id')
      .ilike('family_email', email);

    if (archiveError) {
      throw new Error(archiveError.message || `Failed to load archive rows for ${email}`);
    }

    const storagePaths = (archiveRows || [])
      .map((row) => String(row.storage_path || '').trim())
      .filter((path) => path && path !== 'pending');

    const documentIds = (archiveRows || [])
      .map((row) => row.family_document_id)
      .filter(Boolean) as string[];

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .ilike('email', email)
      .maybeSingle();

    let extraDocIds: string[] = [];
    if (profile?.id) {
      const { data: docs } = await supabase
        .from('family_documents')
        .select('id, url')
        .eq('user_id', profile.id)
        .eq('category', ENROLLMENT_ARCHIVE_CATEGORY);

      extraDocIds = (docs || []).map((doc) => doc.id);
      for (const doc of docs || []) {
        const url = String(doc.url || '').trim();
        if (url && !/^https?:\/\//i.test(url) && !storagePaths.includes(url)) {
          storagePaths.push(url);
        }
      }
    }

    const entry = {
      email,
      archive_rows: archiveRows?.length || 0,
      family_document_ids: [...new Set([...documentIds, ...extraDocIds])],
      storage_paths: storagePaths,
      dry_run: dryRun,
    };

    if (!dryRun) {
      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove(storagePaths);
        if (storageError) {
          console.error(`Failed to remove storage for ${email}:`, storageError.message);
        }
      }

      const allDocIds = [...new Set([...documentIds, ...extraDocIds])];
      if (allDocIds.length > 0) {
        const { error: docDeleteError } = await supabase
          .from('family_documents')
          .delete()
          .in('id', allDocIds);
        if (docDeleteError) {
          throw new Error(docDeleteError.message || `Failed to delete family documents for ${email}`);
        }
      }

      if ((archiveRows || []).length > 0) {
        const { error: archiveDeleteError } = await supabase
          .from('enrollment_document_archive')
          .delete()
          .ilike('family_email', email);
        if (archiveDeleteError) {
          throw new Error(archiveDeleteError.message || `Failed to delete archive rows for ${email}`);
        }
      }
    }

    results.push(entry);
  }

  return results;
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
    const action = payload.action || 'backfill';
    const templateSlug = String(payload.template_slug || DEFAULT_LEGACY_SLUG).trim();
    const dryRun = payload.dry_run === true;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (action === 'cleanup') {
      const emails = payload.emails || [];
      if (!emails.length) {
        return new Response(JSON.stringify({ ok: false, error: 'emails required for cleanup' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const results = await cleanupEnrollmentEmails(supabase, emails, dryRun);
      return new Response(JSON.stringify({
        ok: true,
        action: 'cleanup',
        dry_run: dryRun,
        results,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const template = await fetchTemplateBySlug(templateSlug);

    if (action === 'survey') {
      const emails = payload.emails || [];
      if (!emails.length) {
        return new Response(JSON.stringify({ ok: false, error: 'emails required for survey' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const results: Array<Record<string, unknown>> = [];
      for (const email of emails) {
        const submissions = await fetchSubmissionsForEmail(template.id, email.trim().toLowerCase());
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, email, approved, denied')
          .ilike('email', email.trim().toLowerCase())
          .maybeSingle();

        const { data: archiveRows } = await supabase
          .from('enrollment_document_archive')
          .select('submission_id, delivered_at, storage_path')
          .ilike('family_email', email.trim().toLowerCase());

        results.push({
          email: email.trim().toLowerCase(),
          profile_found: Boolean(profile?.id),
          profile_approved: profile?.approved === true,
          profile_denied: profile?.denied === true,
          archive_rows: archiveRows || [],
          submissions: submissions.map((submission) => ({
            submission_id: submission.id,
            status: submission.status,
            family: resolveFamilyContact(submission),
            submitters: (submission.submitters || []).map((submitter) => ({
              email: submitter.email,
              status: submitter.status,
              role: submitter.role,
            })),
          })),
        });
      }

      return new Response(JSON.stringify({
        ok: true,
        action: 'survey',
        template_slug: templateSlug,
        template_id: template.id,
        results,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const submissions = await fetchCompletedSubmissions(template.id);

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