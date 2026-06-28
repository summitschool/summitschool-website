import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildFamilyHubEmailHtml, escapeHtml } from '../_shared/family-hub-email.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('APPROVAL_FROM_EMAIL') || 'Summit Family Hub <info@summitchurchschool.org>';
const RESET_REDIRECT_URL = Deno.env.get('PASSWORD_RESET_REDIRECT_URL')
  || 'https://summitchurchschool.org/reset-password.html';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ResetPayload = {
  email?: string;
};

function buildResetEmail(email: string, actionLink: string) {
  const subject = 'Reset your Summit Family Hub password';
  const text = [
    'Summit Church School — Family Hub',
    '',
    `We received a request to reset the password for ${email}.`,
    '',
    'Open this link to choose a new password (expires soon, single use):',
    actionLink,
    '',
    'If you did not request this, you can safely ignore this email.',
    '',
    'Summit Family Hub',
    'https://summitchurchschool.org/members.html',
  ].join('\n');

  const html = buildFamilyHubEmailHtml({
    title: 'Reset your Family Hub password',
    preheader: 'Choose a new password for your Summit Family Hub account.',
    paragraphs: [
      `We received a request to reset the password for <strong>${escapeHtml(email)}</strong>.`,
      'Click below to choose a new password. This link expires soon and can only be used once.',
    ],
    ctaLabel: 'Reset Password',
    ctaUrl: actionLink,
    footerNote: 'If you did not request a password reset, you can safely ignore this email. Your password will not change.',
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

  console.log('Password reset email sent', { to, resendId: result?.id });
  return result;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

  try {
    const payload = await req.json() as ResetPayload;
    const email = String(payload.email || '').trim().toLowerCase();

    if (!email || !isValidEmail(email)) {
      return new Response(JSON.stringify({ ok: false, error: 'Please enter a valid email address.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: RESET_REDIRECT_URL,
      },
    });

    if (error || !data?.properties?.action_link) {
      console.log('Password reset skipped (account may not exist):', error?.message || 'missing action_link');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { subject, text, html } = buildResetEmail(email, data.properties.action_link);
    const result = await sendWithResend(email, subject, text, html);

    return new Response(JSON.stringify({ ok: true, to: email, result }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('send-password-reset error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});