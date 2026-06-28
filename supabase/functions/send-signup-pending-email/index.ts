import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildFamilyHubEmailHtml, escapeHtml, FAMILY_HUB_URL } from '../_shared/family-hub-email.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const WEBHOOK_SECRET = Deno.env.get('SIGNUP_PENDING_EMAIL_WEBHOOK_SECRET')
  || Deno.env.get('APPROVAL_EMAIL_WEBHOOK_SECRET');
const FROM_EMAIL = Deno.env.get('APPROVAL_FROM_EMAIL') || 'Summit Church School <info@summitchurchschool.org>';
const FAMILY_HUB_SIGNIN_URL = Deno.env.get('FAMILY_HUB_URL') || FAMILY_HUB_URL;

type SignupPendingPayload = {
  email?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
};

function formatFamilyName(record: SignupPendingPayload) {
  const fullName = String(record.full_name || '').trim();
  if (fullName) return fullName;

  const fromParts = [record.first_name, record.last_name].filter(Boolean).join(' ').trim();
  if (fromParts) return fromParts;

  return 'there';
}

function buildEmail(record: SignupPendingPayload) {
  const name = formatFamilyName(record);
  const subject = 'Summit Family Hub — account received, pending approval';
  const text = [
    `Hello ${name},`,
    '',
    'Thank you for registering for the Summit Family Hub.',
    '',
    'Your account has been created and is now awaiting review by our team. Family Hub access approvals are planned to begin July 1, 2026.',
    '',
    'You will receive another email once your access has been approved. Until then, you can sign in anytime to check your status:',
    FAMILY_HUB_SIGNIN_URL,
    '',
    'Summit Church School',
  ].join('\n');

  const html = buildFamilyHubEmailHtml({
    title: 'Account received — pending approval',
    preheader: 'We received your Family Hub registration and will review it soon.',
    greeting: `Hello ${escapeHtml(name)},`,
    paragraphs: [
      'Thank you for registering for the <strong>Summit Family Hub</strong>.',
      'Your account has been created and is now <strong>awaiting review</strong> by our team. Family Hub access approvals are planned to begin <strong>July 1, 2026</strong>.',
      'You will receive another email once your access has been approved. Until then, you can sign in anytime to check your status.',
    ],
    ctaLabel: 'View Family Hub Status',
    ctaUrl: FAMILY_HUB_SIGNIN_URL,
    footerNote: 'Questions? Contact us through the main site and we will be happy to help.',
  });

  return { subject, text, html };
}

async function sendWithResend(to: string, subject: string, text: string, html: string) {
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
      to: [to],
      subject,
      text,
      html,
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result?.message || result?.error || 'Resend API request failed');
  }

  console.log('Signup pending email sent', { to, resendId: result?.id });
  return result;
}

async function isAuthorized(req: Request, targetEmail: string) {
  if (WEBHOOK_SECRET) {
    const providedSecret = req.headers.get('x-webhook-secret');
    if (providedSecret === WEBHOOK_SECRET) {
      return true;
    }
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user?.email) {
    return false;
  }

  return user.email.trim().toLowerCase() === targetEmail;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload = await req.json() as SignupPendingPayload;
    const email = String(payload.email || '').trim().toLowerCase();

    if (!email) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing email' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!(await isAuthorized(req, email))) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { subject, text, html } = buildEmail(payload);
    const result = await sendWithResend(email, subject, text, html);

    return new Response(JSON.stringify({ ok: true, to: email, result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('send-signup-pending-email error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});