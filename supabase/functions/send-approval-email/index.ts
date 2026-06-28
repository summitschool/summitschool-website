import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildFamilyHubEmailHtml, escapeHtml, FAMILY_HUB_URL } from '../_shared/family-hub-email.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const WEBHOOK_SECRET = Deno.env.get('APPROVAL_EMAIL_WEBHOOK_SECRET');
const FROM_EMAIL = Deno.env.get('APPROVAL_FROM_EMAIL') || 'Summit Church School <info@summitchurchschool.org>';
const FAMILY_HUB_SIGNIN_URL = Deno.env.get('FAMILY_HUB_URL') || FAMILY_HUB_URL;
const ADMIN_EMAIL = (Deno.env.get('FULL_ADMIN_EMAIL') || 'sjesimon@gmail.com').toLowerCase();

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ApprovalPayload = {
  email?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
};

function formatFamilyName(record: ApprovalPayload) {
  const fullName = String(record.full_name || '').trim();
  if (fullName) return fullName;

  const fromParts = [record.first_name, record.last_name].filter(Boolean).join(' ').trim();
  if (fromParts) return fromParts;

  return 'there';
}

function buildEmail(record: ApprovalPayload) {
  const name = formatFamilyName(record);
  const subject = 'Your Summit Family Hub access has been approved';
  const text = [
    `Hello ${name},`,
    '',
    'Great news! Your Summit Family Hub access has been approved.',
    '',
    `You can now sign in at ${FAMILY_HUB_SIGNIN_URL} to view documents, tasks, and school resources.`,
    '',
    'Welcome!',
    '',
    'Summit Church School',
  ].join('\n');

  const html = buildFamilyHubEmailHtml({
    title: 'Your Family Hub access is approved',
    preheader: 'You can now sign in to the Summit Family Hub.',
    greeting: `Hello ${escapeHtml(name)},`,
    paragraphs: [
      'Great news! Your <strong>Summit Family Hub</strong> access has been approved.',
      'You can now sign in to view documents, assigned tasks, school resources, and important updates for your family.',
    ],
    ctaLabel: 'Sign In to Family Hub',
    ctaUrl: FAMILY_HUB_SIGNIN_URL,
    footerNote: 'Welcome to Summit Church School. Contact us through the main site if you need help getting started.',
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

  console.log('Approval email sent', { to, resendId: result?.id });
  return result;
}

async function isAuthorized(req: Request) {
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

  return user.email.toLowerCase() === ADMIN_EMAIL;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    });
  }

  if (!(await isAuthorized(req))) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Unauthorized. Sign in as the admin account to send approval emails.',
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload = await req.json() as ApprovalPayload;
    const email = String(payload.email || '').trim().toLowerCase();

    if (!email) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { subject, text, html } = buildEmail(payload);
    const result = await sendWithResend(email, subject, text, html);

    return new Response(JSON.stringify({ ok: true, to: email, result }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('send-approval-email error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});