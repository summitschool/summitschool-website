import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildEnrollmentAdminEmail,
  buildEnrollmentReceivedFamilyEmail,
} from '../_shared/enrollment-email.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('APPROVAL_FROM_EMAIL') || 'Summit Church School <info@summitchurchschool.org>';
const ADMIN_EMAIL = (Deno.env.get('FULL_ADMIN_EMAIL') || 'sjesimon@gmail.com').toLowerCase();

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const WEBHOOK_SECRET = Deno.env.get('DOCUSEAL_ENROLLMENT_WEBHOOK_SECRET');
const HMAC_SECRET = Deno.env.get('DOCUSEAL_WEBHOOK_HMAC_SECRET');

const DOCUSEAL_API_URL = (Deno.env.get('DOCUSEAL_API_URL') || 'https://enroll.summitchurchschool.org').replace(/\/$/, '');
const DOCUSEAL_API_KEY = Deno.env.get('DOCUSEAL_API_KEY') || '';

const DEFAULT_ENROLLMENT_SLUGS = 'vi3n5SzMfFnRLH';
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret, x-docuseal-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type FieldValue = {
  field?: string;
  value?: string;
};

type DocuSealWebhookPayload = {
  event_type?: string;
  timestamp?: string;
  data?: {
    id?: number;
    email?: string;
    name?: string | null;
    status?: string;
    role?: string;
    values?: FieldValue[];
    documents?: Array<{ name?: string; url?: string }>;
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
};

type DocuSealTemplate = {
  id: number;
  slug?: string;
  name?: string;
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

function extractFirstName(data: NonNullable<DocuSealWebhookPayload['data']>) {
  const fullName = String(data.name || '').trim();
  if (fullName) {
    return fullName.split(/\s+/)[0];
  }

  const preferredFields = [
    'First Name',
    'Parent First Name',
    'Enrolling Parent First Name',
    'Mother First Name',
    'Father First Name',
  ];

  for (const fieldName of preferredFields) {
    const match = (data.values || []).find((entry) => entry.field === fieldName && entry.value);
    if (match?.value) {
      return String(match.value).trim().split(/\s+/)[0];
    }
  }

  return 'there';
}

async function fetchDocumentAttachment(documents: Array<{ name?: string; url?: string }> | undefined) {
  const document = (documents || []).find((entry) => entry.url);
  if (!document?.url) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(document.url, { signal: controller.signal });
    if (!response.ok) {
      console.error('enrollment document fetch failed', response.status);
      return null;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      console.error('enrollment document skipped due to size', bytes.byteLength);
      return null;
    }

    let binary = '';
    for (let i = 0; i < bytes.byteLength; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }

    const safeName = String(document.name || 'Summit-Enrollment-Application')
      .replace(/[^\w.\- ]+/g, '')
      .trim() || 'Summit-Enrollment-Application';

    return {
      filename: safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`,
      content: btoa(binary),
    };
  } catch (error) {
    console.error('enrollment document fetch error:', error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendWithResend(options: {
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{ filename: string; content: string }>;
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

async function reserveSubmissionSend(submissionId: number, templateId: number | undefined, submitterEmail: string) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await supabase
    .from('enrollment_email_log')
    .insert({
      submission_id: submissionId,
      template_id: templateId ?? null,
      submitter_email: submitterEmail || null,
    });

  if (error?.code === '23505') {
    return false;
  }

  if (error) {
    throw new Error(error.message || 'Failed to record enrollment email send');
  }

  return true;
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

    if (eventType !== 'form.completed' || !data) {
      return new Response(JSON.stringify({ ok: true, skipped: 'unsupported_event' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (data.status !== 'completed' || data.submission?.status !== 'completed') {
      return new Response(JSON.stringify({ ok: true, skipped: 'submission_not_completed' }), {
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

    const submissionId = data.submission?.id;
    const submitterEmail = String(data.email || '').trim().toLowerCase();

    if (!submissionId) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing submission id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!submitterEmail) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing submitter email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const shouldSend = await reserveSubmissionSend(submissionId, templateId, submitterEmail);
    if (!shouldSend) {
      return new Response(JSON.stringify({ ok: true, skipped: 'already_sent', submission_id: submissionId }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const firstName = extractFirstName(data);
    const attachment = await fetchDocumentAttachment(data.documents);
    const familyEmail = buildEnrollmentReceivedFamilyEmail(firstName, Boolean(attachment));

    const familyResult = await sendWithResend({
      to: [submitterEmail],
      subject: familyEmail.subject,
      text: familyEmail.text,
      html: familyEmail.html,
      attachments: attachment ? [attachment] : undefined,
    });

    const adminEmail = buildEnrollmentAdminEmail({
      submitterName: String(data.name || '').trim() || submitterEmail,
      submitterEmail,
      templateName: String(data.template?.name || 'Enrollment Application'),
      submissionId,
      docuSealBaseUrl: DOCUSEAL_API_URL,
    });

    const adminResult = await sendWithResend({
      to: [ADMIN_EMAIL],
      subject: adminEmail.subject,
      text: adminEmail.text,
      html: adminEmail.html,
    });

    console.log('Enrollment emails sent', {
      submissionId,
      templateId,
      to: submitterEmail,
      familyResendId: familyResult?.id,
      adminResendId: adminResult?.id,
      attachment: Boolean(attachment),
    });

    return new Response(JSON.stringify({
      ok: true,
      submission_id: submissionId,
      template_id: templateId,
      family: familyResult,
      admin: adminResult,
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