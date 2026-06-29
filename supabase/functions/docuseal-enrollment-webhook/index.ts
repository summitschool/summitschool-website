import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildEnrollmentAdminSignatureRequestEmail,
  buildEnrollmentReceivedFamilyEmail,
  ENROLLMENT_ADMIN_SIGNED_URL,
} from '../_shared/enrollment-email.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('APPROVAL_FROM_EMAIL') || 'Summit Church School <info@summitchurchschool.org>';
const SIGNATURE_ADMIN_EMAIL = (Deno.env.get('ENROLLMENT_SIGNATURE_EMAIL') || 'info@summitchurchschool.org').toLowerCase();

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const WEBHOOK_SECRET = Deno.env.get('DOCUSEAL_ENROLLMENT_WEBHOOK_SECRET');
const HMAC_SECRET = Deno.env.get('DOCUSEAL_WEBHOOK_HMAC_SECRET');

const DOCUSEAL_API_URL = (Deno.env.get('DOCUSEAL_API_URL') || 'https://enroll.summitchurchschool.org').replace(/\/$/, '');
const DOCUSEAL_API_KEY = Deno.env.get('DOCUSEAL_API_KEY') || '';

const DEFAULT_ENROLLMENT_SLUGS = 'vi3n5SzMfFnRLH';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret, x-docuseal-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type FieldValue = {
  field?: string;
  value?: string;
};

type DocuSealSubmitter = {
  id?: number;
  email?: string;
  name?: string | null;
  role?: string;
  status?: string;
  slug?: string;
  embed_src?: string;
};

type DocuSealSubmissionWebhookData = {
  id?: number;
  status?: string;
  email?: string;
  name?: string | null;
  role?: string;
  values?: FieldValue[];
  submitters?: DocuSealSubmitter[];
  submission?: {
    id?: number;
    status?: string;
    url?: string;
  };
  template?: {
    id?: number;
    name?: string;
    external_id?: string | null;
    folder_name?: string;
  };
};

type DocuSealWebhookPayload = {
  event_type?: string;
  timestamp?: string;
  data?: DocuSealSubmissionWebhookData;
};

type DocuSealTemplate = {
  id: number;
  slug?: string;
  name?: string;
};

type EnrollmentEmailLog = {
  submission_id: number;
  template_id: number | null;
  family_email: string | null;
  family_name: string | null;
  admin_pending_notified_at: string | null;
  family_notified_at: string | null;
};

let cachedEnrollmentTemplateIds: Set<number> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function parseIdList(raw: string | undefined) {
  return (raw || '')
    .split(',')
    .map((value) => parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value));
}

function parseSlugList(raw: string | undefined) {
  return (raw || DEFAULT_ENROLLMENT_SLUGS)
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

async function fetchEnrollmentTemplateIds() {
  const now = Date.now();
  if (cachedEnrollmentTemplateIds && (now - cacheLoadedAt) < CACHE_TTL_MS) {
    return cachedEnrollmentTemplateIds;
  }

  const ids = new Set<number>(parseIdList(Deno.env.get('DOCUSEAL_ENROLLMENT_TEMPLATE_IDS')));
  const slugs = parseSlugList(Deno.env.get('DOCUSEAL_ENROLLMENT_TEMPLATE_SLUGS'));

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
          }
        }
      } else {
        console.error('docuseal template lookup failed', response.status, await response.text());
      }
    } catch (error) {
      console.error('docuseal template lookup error:', error);
    }
  }

  cachedEnrollmentTemplateIds = ids;
  cacheLoadedAt = now;
  return ids;
}

function isEnrollmentTemplate(templateId: number | undefined, allowedIds: Set<number>) {
  if (!templateId || allowedIds.size === 0) return false;
  return allowedIds.has(templateId);
}

function extractFirstName(fullName: string, values: FieldValue[] | undefined) {
  const trimmed = fullName.trim();
  if (trimmed) {
    return trimmed.split(/\s+/)[0];
  }

  const preferredFields = [
    'First Name',
    'Parent First Name',
    'Enrolling Parent First Name',
    'Mother First Name',
    'Father First Name',
  ];

  for (const fieldName of preferredFields) {
    const match = (values || []).find((entry) => entry.field === fieldName && entry.value);
    if (match?.value) {
      return String(match.value).trim().split(/\s+/)[0];
    }
  }

  return 'there';
}

function supabaseAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function getEnrollmentLog(submissionId: number) {
  const { data, error } = await supabaseAdmin()
    .from('enrollment_email_log')
    .select('submission_id, template_id, family_email, family_name, admin_pending_notified_at, family_notified_at')
    .eq('submission_id', submissionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to load enrollment email log');
  }

  return data as EnrollmentEmailLog | null;
}

async function upsertFamilySubmissionRecord(options: {
  submissionId: number;
  templateId: number | undefined;
  familyEmail: string;
  familyName: string;
}) {
  const { error } = await supabaseAdmin()
    .from('enrollment_email_log')
    .upsert({
      submission_id: options.submissionId,
      template_id: options.templateId ?? null,
      family_email: options.familyEmail,
      family_name: options.familyName,
    }, { onConflict: 'submission_id' });

  if (error) {
    throw new Error(error.message || 'Failed to save enrollment family record');
  }
}

async function markAdminPendingNotified(submissionId: number) {
  const { error } = await supabaseAdmin()
    .from('enrollment_email_log')
    .update({ admin_pending_notified_at: new Date().toISOString() })
    .eq('submission_id', submissionId)
    .is('admin_pending_notified_at', null);

  if (error) {
    throw new Error(error.message || 'Failed to mark admin pending notification');
  }
}

async function markFamilyNotified(submissionId: number) {
  const { error } = await supabaseAdmin()
    .from('enrollment_email_log')
    .update({ family_notified_at: new Date().toISOString() })
    .eq('submission_id', submissionId)
    .is('family_notified_at', null);

  if (error) {
    throw new Error(error.message || 'Failed to mark family notification');
  }
}

function buildSubmitterSigningUrl(submitter: DocuSealSubmitter | undefined) {
  if (!submitter) return null;

  const embedSrc = String(submitter.embed_src || '').trim();
  if (embedSrc) return embedSrc;

  const slug = String(submitter.slug || '').trim();
  if (slug) return `${DOCUSEAL_API_URL}/s/${slug}`;

  return null;
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

function findAdminSubmitter(submitters: DocuSealSubmitter[] | null | undefined) {
  if (!submitters?.length) return undefined;

  return submitters.find((submitter) => (
    String(submitter.email || '').trim().toLowerCase() === SIGNATURE_ADMIN_EMAIL
  ));
}

async function configureAdminSubmitter(submitterId: number) {
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
        send_email: false,
        completed_redirect_url: ENROLLMENT_ADMIN_SIGNED_URL,
      }),
    });

    if (!response.ok) {
      console.error('docuseal admin submitter update failed', response.status, await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error('docuseal admin submitter update error:', error);
    return false;
  }
}

async function resolveAdminSigningUrl(submissionId: number) {
  const submitters = await fetchSubmissionSubmitters(submissionId);
  if (!submitters) return null;

  const adminSubmitter = findAdminSubmitter(submitters);

  if (adminSubmitter?.id) {
    await configureAdminSubmitter(adminSubmitter.id);
  }

  return buildSubmitterSigningUrl(adminSubmitter);
}

async function fetchFamilyContactFromSubmission(submissionId: number) {
  const submitters = await fetchSubmissionSubmitters(submissionId);
  if (!submitters) return null;

  const adminEmails = new Set([SIGNATURE_ADMIN_EMAIL]);
  const familySubmitter = submitters.find((submitter) => {
    const email = String(submitter.email || '').trim().toLowerCase();
    return email && !adminEmails.has(email);
  });

  if (!familySubmitter?.email) return null;

  return {
    email: String(familySubmitter.email).trim().toLowerCase(),
    name: String(familySubmitter.name || '').trim(),
    values: undefined as FieldValue[] | undefined,
  };
}

async function sendWithResend(options: {
  to: string[];
  subject: string;
  text: string;
  html: string;
}) {
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY must be set on the Edge Function.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result?.message || result?.error || 'Resend API request failed');
  }

  return result;
}

async function handleSubmissionCreated(options: {
  submissionId: number;
  templateId: number | undefined;
  submitters?: DocuSealSubmitter[];
}) {
  const adminSubmitter = findAdminSubmitter(options.submitters);

  if (!adminSubmitter?.id) {
    const submitters = await fetchSubmissionSubmitters(options.submissionId);
    const fetchedAdmin = findAdminSubmitter(submitters || undefined);

    if (!fetchedAdmin?.id) {
      return { skipped: 'admin_submitter_not_found' as const };
    }

    const updated = await configureAdminSubmitter(fetchedAdmin.id);
    return updated
      ? { action: 'admin_docuseal_email_disabled' as const, submitter_id: fetchedAdmin.id }
      : { skipped: 'admin_submitter_update_failed' as const };
  }

  const updated = await configureAdminSubmitter(adminSubmitter.id);

  return updated
    ? { action: 'admin_docuseal_email_disabled' as const, submitter_id: adminSubmitter.id }
    : { skipped: 'admin_submitter_update_failed' as const };
}

async function handleFamilySubmitted(options: {
  submissionId: number;
  templateId: number | undefined;
  familyEmail: string;
  familyName: string;
  templateName: string;
  values: FieldValue[] | undefined;
}) {
  const existing = await getEnrollmentLog(options.submissionId);

  if (existing?.admin_pending_notified_at) {
    return { skipped: 'admin_pending_already_sent' as const };
  }

  await upsertFamilySubmissionRecord(options);

  const signingUrl = await resolveAdminSigningUrl(options.submissionId);
  const fallbackReviewUrl = `${DOCUSEAL_API_URL}/submissions/${options.submissionId}`;

  const adminEmail = buildEnrollmentAdminSignatureRequestEmail({
    submitterName: options.familyName || options.familyEmail,
    submitterEmail: options.familyEmail,
    templateName: options.templateName,
    submissionId: options.submissionId,
    signingUrl: signingUrl || fallbackReviewUrl,
    fallbackReviewUrl,
  });

  const adminResult = await sendWithResend({
    to: [SIGNATURE_ADMIN_EMAIL],
    subject: adminEmail.subject,
    text: adminEmail.text,
    html: adminEmail.html,
  });

  await markAdminPendingNotified(options.submissionId);

  return { action: 'admin_signature_request' as const, admin: adminResult };
}

async function handleSubmissionFullySigned(options: {
  submissionId: number;
  templateId: number | undefined;
  templateName: string;
  fallbackValues?: FieldValue[];
}) {
  const existing = await getEnrollmentLog(options.submissionId);

  if (existing?.family_notified_at) {
    return { skipped: 'family_already_notified' as const };
  }

  let familyEmail = String(existing?.family_email || '').trim().toLowerCase();
  let familyName = String(existing?.family_name || '').trim();

  if (!familyEmail) {
    const fetched = await fetchFamilyContactFromSubmission(options.submissionId);
    if (fetched?.email) {
      familyEmail = fetched.email;
      familyName = fetched.name || familyName;
      await upsertFamilySubmissionRecord({
        submissionId: options.submissionId,
        templateId: options.templateId,
        familyEmail,
        familyName,
      });
    }
  }

  if (!familyEmail) {
    throw new Error('Could not determine family email for completed enrollment submission');
  }

  const firstName = extractFirstName(familyName, options.fallbackValues);
  const familyEmailContent = buildEnrollmentReceivedFamilyEmail(firstName);

  const familyResult = await sendWithResend({
    to: [familyEmail],
    subject: familyEmailContent.subject,
    text: familyEmailContent.text,
    html: familyEmailContent.html,
  });

  await markFamilyNotified(options.submissionId);

  return { action: 'family_next_steps' as const, family: familyResult, to: familyEmail };
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

    const allowedTemplateIds = await fetchEnrollmentTemplateIds();
    const templateId = data.template?.id;

    if (!isEnrollmentTemplate(templateId, allowedTemplateIds)) {
      return new Response(JSON.stringify({
        ok: true,
        skipped: 'not_enrollment_template',
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

    if (eventType === 'submission.created') {
      const result = await handleSubmissionCreated({
        submissionId,
        templateId,
        submitters: data.submitters,
      });

      console.log('Enrollment admin DocuSeal email disabled', { submissionId, templateId, result });

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

    const templateName = String(data.template?.name || 'Enrollment Application');
    const submissionStatus = String(data.submission?.status || '').toLowerCase();
    const isFullySigned = submissionStatus === 'completed';

    if (!isFullySigned) {
      const familyEmail = String(data.email || '').trim().toLowerCase();
      if (!familyEmail) {
        return new Response(JSON.stringify({ ok: false, error: 'Missing family submitter email' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const result = await handleFamilySubmitted({
        submissionId,
        templateId,
        familyEmail,
        familyName: String(data.name || '').trim(),
        templateName,
        values: data.values,
      });

      console.log('Enrollment admin signature request handled', { submissionId, templateId, familyEmail, result });

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

    const result = await handleSubmissionFullySigned({
      submissionId,
      templateId,
      templateName,
      fallbackValues: data.values,
    });

    console.log('Enrollment family notification handled', { submissionId, templateId, result });

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
    console.error('docuseal-enrollment-webhook error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});