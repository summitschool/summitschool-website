import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { archiveDocuSealSubmissionToHub } from '../_shared/archive-docuseal-to-hub.ts';
import { buildDmvPermitFormCompleteUrl } from '../_shared/dmv-form-email.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const WEBHOOK_SECRET = Deno.env.get('DOCUSEAL_DMV_WEBHOOK_SECRET')
  || Deno.env.get('DOCUSEAL_ENROLLMENT_WEBHOOK_SECRET');
const HMAC_SECRET = Deno.env.get('DOCUSEAL_WEBHOOK_HMAC_SECRET');

const DOCUSEAL_API_URL = (Deno.env.get('DOCUSEAL_API_URL') || 'https://enroll.summitchurchschool.org').replace(/\/$/, '');
const DOCUSEAL_API_KEY = Deno.env.get('DOCUSEAL_API_KEY') || '';

const DEFAULT_DMV_SLUGS = 'vfjkLH3hKczzX9';
const DMV_ARCHIVE_SCHOOL_YEAR = Deno.env.get('DOCUSEAL_DMV_ARCHIVE_SCHOOL_YEAR') || '2026-2027';
const DMV_ARCHIVE_CATEGORY = Deno.env.get('DOCUSEAL_DMV_ARCHIVE_CATEGORY') || 'Signed Form';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret, x-docuseal-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type DocuSealSubmitter = {
  id?: number;
  email?: string;
  slug?: string;
};

type DocuSealWebhookPayload = {
  event_type?: string;
  data?: {
    id?: number;
    email?: string;
    status?: string;
    submission?: {
      id?: number;
      status?: string;
    };
    submitters?: DocuSealSubmitter[];
    template?: {
      id?: number;
      name?: string;
    };
  };
};

type DocuSealTemplate = {
  id: number;
  slug?: string;
  name?: string;
};

type DmvTemplateCache = {
  ids: Set<number>;
  slugById: Map<number, string>;
};

let cachedDmvTemplates: DmvTemplateCache | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function parseIdList(raw: string | undefined) {
  return (raw || '')
    .split(',')
    .map((value) => parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value));
}

function parseSlugList(raw: string | undefined) {
  return (raw || DEFAULT_DMV_SLUGS)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function verifyDocuSealHmac(rawBody: string, signatureHeader: string, secret: string) {
  const [timestamp, signature] = signatureHeader.split('.', 2);
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const payload = new TextEncoder().encode(`${timestamp}.${rawBody}`);
  const digest = await crypto.subtle.sign('HMAC', key, payload);
  const expected = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return timingSafeEqual(expected, signature);
}

async function isAuthorized(req: Request, rawBody: string) {
  if (WEBHOOK_SECRET) {
    const provided = req.headers.get('x-webhook-secret');
    if (provided === WEBHOOK_SECRET) return true;
  }

  if (HMAC_SECRET) {
    const signature = req.headers.get('x-docuseal-signature');
    if (signature && await verifyDocuSealHmac(rawBody, signature, HMAC_SECRET)) {
      return true;
    }
  }

  return false;
}

async function fetchDmvTemplates() {
  const now = Date.now();
  if (cachedDmvTemplates && (now - cacheLoadedAt) < CACHE_TTL_MS) {
    return cachedDmvTemplates;
  }

  const ids = new Set<number>(parseIdList(Deno.env.get('DOCUSEAL_DMV_TEMPLATE_IDS')));
  const slugs = parseSlugList(Deno.env.get('DOCUSEAL_DMV_TEMPLATE_SLUGS'));
  const slugById = new Map<number, string>();

  if (slugs.length === 1) {
    for (const templateId of ids) {
      slugById.set(templateId, slugs[0]);
    }
  }

  if (slugs.length > 0 && DOCUSEAL_API_KEY) {
    try {
      const response = await fetch(`${DOCUSEAL_API_URL}/api/templates?limit=100`, {
        headers: {
          'X-Auth-Token': DOCUSEAL_API_KEY,
          Accept: 'application/json',
        },
      });

      if (response.ok) {
        const body = await response.json() as { data?: DocuSealTemplate[] };
        for (const template of body.data || []) {
          if (template.slug && slugs.includes(template.slug)) {
            ids.add(template.id);
            slugById.set(template.id, template.slug);
          }
        }
      } else {
        console.error('docuseal dmv template lookup failed', response.status, await response.text());
      }
    } catch (error) {
      console.error('docuseal dmv template lookup error:', error);
    }
  }

  cachedDmvTemplates = { ids, slugById };
  cacheLoadedAt = now;
  return cachedDmvTemplates;
}

function isDmvTemplate(templateId: number | undefined, allowedIds: Set<number>) {
  if (!templateId || allowedIds.size === 0) return false;
  return allowedIds.has(templateId);
}

function resolveTemplateSlug(templateId?: number, slugById?: Map<number, string>) {
  if (templateId && slugById?.has(templateId)) {
    return slugById.get(templateId)!;
  }

  const slugs = parseSlugList(Deno.env.get('DOCUSEAL_DMV_TEMPLATE_SLUGS'));
  if (slugs.length === 1) return slugs[0];
  return slugs[0] || DEFAULT_DMV_SLUGS;
}

async function fetchSubmissionSubmitters(submissionId: number) {
  if (!DOCUSEAL_API_KEY) return null;

  try {
    const response = await fetch(`${DOCUSEAL_API_URL}/api/submissions/${submissionId}`, {
      headers: {
        'X-Auth-Token': DOCUSEAL_API_KEY,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error('docuseal submission lookup failed', response.status, await response.text());
      return null;
    }

    const submission = await response.json() as { submitters?: DocuSealSubmitter[] };
    return submission.submitters || [];
  } catch (error) {
    console.error('docuseal submission lookup error:', error);
    return null;
  }
}

async function configureSubmitterRedirect(submitterId: number, templateSlug: string) {
  if (!DOCUSEAL_API_KEY) return false;

  try {
    const response = await fetch(`${DOCUSEAL_API_URL}/api/submitters/${submitterId}`, {
      method: 'PUT',
      headers: {
        'X-Auth-Token': DOCUSEAL_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        completed_redirect_url: buildDmvPermitFormCompleteUrl(templateSlug),
      }),
    });

    if (!response.ok) {
      console.error('docuseal dmv redirect update failed', response.status, await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error('docuseal dmv redirect update error:', error);
    return false;
  }
}

async function handleSubmissionCreated(options: {
  submissionId: number;
  templateSlug: string;
  submitters?: DocuSealSubmitter[];
}) {
  const submitters = options.submitters?.length
    ? options.submitters
    : await fetchSubmissionSubmitters(options.submissionId);

  const submitter = submitters?.find((entry) => entry.id);
  if (!submitter?.id) {
    return { skipped: 'submitter_not_found' as const };
  }

  const updated = await configureSubmitterRedirect(submitter.id, options.templateSlug);
  return updated
    ? { action: 'redirect_configured' as const, submitter_id: submitter.id }
    : { skipped: 'redirect_update_failed' as const };
}

async function handleFormCompleted(options: {
  submissionId: number;
  templateId?: number;
  templateSlug: string;
  templateName: string;
  familyEmail: string;
}) {
  return archiveDocuSealSubmissionToHub({
    supabaseUrl: SUPABASE_URL,
    supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    submissionId: options.submissionId,
    templateId: options.templateId,
    templateSlug: options.templateSlug,
    templateName: options.templateName,
    familyEmail: options.familyEmail,
    docusealApiUrl: DOCUSEAL_API_URL,
    docusealApiKey: DOCUSEAL_API_KEY,
    schoolYear: DMV_ARCHIVE_SCHOOL_YEAR,
    category: DMV_ARCHIVE_CATEGORY,
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const rawBody = await req.text();

  if (!(await isAuthorized(req, rawBody))) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Unauthorized webhook',
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload = JSON.parse(rawBody) as DocuSealWebhookPayload;
    const eventType = String(payload.event_type || '');
    const data = payload.data;

    if (!data || (eventType !== 'form.completed' && eventType !== 'submission.created')) {
      return new Response(JSON.stringify({ ok: true, skipped: 'unsupported_event' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const dmvTemplates = await fetchDmvTemplates();
    const templateId = data.template?.id;

    if (!isDmvTemplate(templateId, dmvTemplates.ids)) {
      return new Response(JSON.stringify({
        ok: true,
        skipped: 'not_dmv_template',
        template_id: templateId ?? null,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const submissionId = eventType === 'submission.created'
      ? data.id
      : data.submission?.id;

    if (!submissionId) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing submission id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const templateSlug = resolveTemplateSlug(templateId, dmvTemplates.slugById);

    if (eventType === 'submission.created') {
      const result = await handleSubmissionCreated({
        submissionId,
        templateSlug,
        submitters: data.submitters,
      });

      console.log('DMV form redirect configured', { submissionId, templateId, result });

      return new Response(JSON.stringify({
        ok: true,
        submission_id: submissionId,
        template_id: templateId,
        ...result,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (data.status !== 'completed') {
      return new Response(JSON.stringify({ ok: true, skipped: 'submitter_not_completed' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const submissionStatus = String(data.submission?.status || '').toLowerCase();
    if (submissionStatus !== 'completed') {
      return new Response(JSON.stringify({ ok: true, skipped: 'submission_not_completed' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const familyEmail = String(data.email || '').trim().toLowerCase();
    if (!familyEmail) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing family submitter email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await handleFormCompleted({
      submissionId,
      templateId,
      templateSlug,
      templateName: String(data.template?.name || 'Driver Education Form'),
      familyEmail,
    });

    console.log('DMV form archived to hub', { submissionId, templateId, familyEmail, result });

    return new Response(JSON.stringify({
      ok: true,
      submission_id: submissionId,
      template_id: templateId,
      ...result,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('docuseal-dmv-webhook error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});