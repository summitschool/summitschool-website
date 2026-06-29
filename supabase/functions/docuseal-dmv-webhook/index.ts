import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { completeFamilyDocuSealTasks } from '../_shared/complete-family-docuseal-task.ts';
import {
  buildDmvPermitFormCompletedEmail,
  buildDmvPermitFormCompleteUrl,
} from '../_shared/dmv-form-email.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('APPROVAL_FROM_EMAIL') || 'Summit Church School <info@summitchurchschool.org>';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const WEBHOOK_SECRET = Deno.env.get('DOCUSEAL_DMV_WEBHOOK_SECRET')
  || Deno.env.get('DOCUSEAL_ENROLLMENT_WEBHOOK_SECRET');
const HMAC_SECRET = Deno.env.get('DOCUSEAL_WEBHOOK_HMAC_SECRET');

const DOCUSEAL_API_URL = (Deno.env.get('DOCUSEAL_API_URL') || 'https://enroll.summitchurchschool.org').replace(/\/$/, '');
const DOCUSEAL_API_KEY = Deno.env.get('DOCUSEAL_API_KEY') || '';

const DEFAULT_DMV_SLUGS = 'vfjkLH3hKczzX9';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret, x-docuseal-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type DocuSealSubmitter = {
  id?: number;
  email?: string;
  name?: string | null;
  slug?: string;
};

type DocuSealWebhookPayload = {
  event_type?: string;
  data?: {
    id?: number;
    email?: string;
    name?: string | null;
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

type DocuSealDocument = {
  name?: string;
  url?: string;
};

type DmvEmailLog = {
  submission_id: number;
  family_email: string | null;
  family_notified_at: string | null;
};

let cachedDmvTemplateIds: Set<number> | null = null;
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

async function fetchDmvTemplateIds() {
  const now = Date.now();
  if (cachedDmvTemplateIds && (now - cacheLoadedAt) < CACHE_TTL_MS) {
    return cachedDmvTemplateIds;
  }

  const ids = new Set<number>(parseIdList(Deno.env.get('DOCUSEAL_DMV_TEMPLATE_IDS')));
  const slugs = parseSlugList(Deno.env.get('DOCUSEAL_DMV_TEMPLATE_SLUGS'));

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
        console.error('docuseal dmv template lookup failed', response.status, await response.text());
      }
    } catch (error) {
      console.error('docuseal dmv template lookup error:', error);
    }
  }

  cachedDmvTemplateIds = ids;
  cacheLoadedAt = now;
  return ids;
}

function isDmvTemplate(templateId: number | undefined, allowedIds: Set<number>) {
  if (!templateId || allowedIds.size === 0) return false;
  return allowedIds.has(templateId);
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function extractRecipientName(name: string, email: string) {
  const trimmed = name.trim();
  if (trimmed && trimmed.toLowerCase() !== email.toLowerCase() && !looksLikeEmail(trimmed)) {
    return trimmed;
  }
  return '';
}

function supabaseAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function getDmvLog(submissionId: number) {
  const { data, error } = await supabaseAdmin()
    .from('dmv_email_log')
    .select('submission_id, family_email, family_notified_at')
    .eq('submission_id', submissionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to load DMV email log');
  }

  return data as DmvEmailLog | null;
}

async function upsertDmvRecord(options: {
  submissionId: number;
  templateId: number | undefined;
  familyEmail: string;
  familyName: string;
}) {
  const { error } = await supabaseAdmin()
    .from('dmv_email_log')
    .upsert({
      submission_id: options.submissionId,
      template_id: options.templateId ?? null,
      family_email: options.familyEmail,
      family_name: options.familyName,
    }, { onConflict: 'submission_id' });

  if (error) {
    throw new Error(error.message || 'Failed to save DMV email record');
  }
}

async function markFamilyNotified(submissionId: number) {
  const { error } = await supabaseAdmin()
    .from('dmv_email_log')
    .update({ family_notified_at: new Date().toISOString() })
    .eq('submission_id', submissionId)
    .is('family_notified_at', null);

  if (error) {
    throw new Error(error.message || 'Failed to mark DMV family notification');
  }
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

function primaryDmvTemplateSlug() {
  return parseSlugList(Deno.env.get('DOCUSEAL_DMV_TEMPLATE_SLUGS'))[0] || DEFAULT_DMV_SLUGS;
}

async function configureSubmitterRedirect(submitterId: number, templateSlug?: string) {
  if (!DOCUSEAL_API_KEY) return false;

  const slug = templateSlug || primaryDmvTemplateSlug();

  try {
    const response = await fetch(`${DOCUSEAL_API_URL}/api/submitters/${submitterId}`, {
      method: 'PUT',
      headers: {
        'X-Auth-Token': DOCUSEAL_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        completed_redirect_url: buildDmvPermitFormCompleteUrl(slug),
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

async function fetchSubmissionDocuments(submissionId: number) {
  if (!DOCUSEAL_API_KEY) {
    throw new Error('DOCUSEAL_API_KEY must be set to fetch signed documents.');
  }

  const response = await fetch(
    `${DOCUSEAL_API_URL}/api/submissions/${submissionId}/documents?merge=true`,
    {
      headers: {
        'X-Auth-Token': DOCUSEAL_API_KEY,
        Accept: 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`DocuSeal documents lookup failed (${response.status}): ${await response.text()}`);
  }

  const body = await response.json() as { documents?: DocuSealDocument[] };
  return body.documents || [];
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function downloadDocumentAttachment(document: DocuSealDocument, fallbackName: string) {
  const url = String(document.url || '').trim();
  if (!url) {
    throw new Error('Signed document URL missing from DocuSeal response');
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download signed document (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || 'application/pdf';
  const bytes = new Uint8Array(await response.arrayBuffer());
  const rawName = String(document.name || fallbackName).trim() || fallbackName;
  const filename = rawName.toLowerCase().endsWith('.pdf') ? rawName : `${rawName}.pdf`;

  return {
    filename,
    content: bytesToBase64(bytes),
    content_type: contentType,
  };
}

async function sendWithResend(options: {
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments: Array<{ filename: string; content: string; content_type?: string }>;
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
      attachments: options.attachments,
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
  submitters?: DocuSealSubmitter[];
}) {
  const submitter = options.submitters?.find((entry) => entry.id);

  if (submitter?.id) {
    const updated = await configureSubmitterRedirect(submitter.id);
    return updated
      ? { action: 'redirect_configured' as const, submitter_id: submitter.id }
      : { skipped: 'redirect_update_failed' as const };
  }

  const submitters = await fetchSubmissionSubmitters(options.submissionId);
  const familySubmitter = submitters?.find((entry) => entry.id);

  if (!familySubmitter?.id) {
    return { skipped: 'submitter_not_found' as const };
  }

  const updated = await configureSubmitterRedirect(familySubmitter.id);
  return updated
    ? { action: 'redirect_configured' as const, submitter_id: familySubmitter.id }
    : { skipped: 'redirect_update_failed' as const };
}

async function handleFormCompleted(options: {
  submissionId: number;
  templateId: number | undefined;
  templateName: string;
  familyEmail: string;
  familyName: string;
}) {
  const existing = await getDmvLog(options.submissionId);

  if (existing?.family_notified_at) {
    return { skipped: 'family_already_notified' as const };
  }

  await upsertDmvRecord(options);

  const documents = await fetchSubmissionDocuments(options.submissionId);
  if (documents.length === 0) {
    throw new Error('No signed documents available for completed DMV submission');
  }

  const attachments = await Promise.all(
    documents.map((document, index) => downloadDocumentAttachment(
      document,
      `${options.templateName || 'dmv-form'}-${options.submissionId}${documents.length > 1 ? `-${index + 1}` : ''}`,
    )),
  );

  const email = buildDmvPermitFormCompletedEmail({
    recipientName: options.familyName || options.familyEmail,
    templateName: options.templateName,
  });

  const familyResult = await sendWithResend({
    to: [options.familyEmail],
    subject: email.subject,
    text: email.text,
    html: email.html,
    attachments,
  });

  await markFamilyNotified(options.submissionId);

  const taskResult = await completeFamilyDocuSealTasks({
    supabaseUrl: SUPABASE_URL,
    supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    familyEmail: options.familyEmail,
    templateId: options.templateId,
    docusealApiUrl: DOCUSEAL_API_URL,
    docusealApiKey: DOCUSEAL_API_KEY,
  });

  return {
    action: 'family_form_attached' as const,
    family: familyResult,
    to: options.familyEmail,
    attachments: attachments.map((attachment) => attachment.filename),
    tasks: taskResult,
  };
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

    const allowedTemplateIds = await fetchDmvTemplateIds();
    const templateId = data.template?.id;

    if (!isDmvTemplate(templateId, allowedTemplateIds)) {
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

    if (eventType === 'submission.created') {
      const result = await handleSubmissionCreated({
        submissionId,
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
      templateName: String(data.template?.name || 'Driver Education Form'),
      familyEmail,
      familyName: extractRecipientName(String(data.name || '').trim(), familyEmail),
    });

    console.log('DMV form family email handled', { submissionId, templateId, familyEmail, result });

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