import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildFamilyHubEmailHtml, escapeHtml } from '../_shared/family-hub-email.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('APPROVAL_FROM_EMAIL') || 'Summit Church School <info@summitchurchschool.org>';
const CONFIRM_REDIRECT_URL = Deno.env.get('CONFIRM_EMAIL_REDIRECT_URL')
  || 'https://summitchurchschool.org/confirm-email.html';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ConfirmPayload = {
  email?: string;
  redirectTo?: string;
};

function buildConfirmEmail(email: string, actionLink: string, firstName = '') {
  const greeting = firstName
    ? `Hello ${escapeHtml(firstName)},`
    : 'Hello,';
  const subject = 'Confirm your Summit Family Hub email';
  const text = [
    'Summit Church School — Family Hub',
    '',
    'Use the link below to confirm your email address and finish setting up your Family Hub account.',
    '',
    actionLink,
    '',
    'If your previous link expired, this new link will work.',
    '',
    'After confirming, you can sign in anytime while your account awaits staff approval.',
    '',
    'If you did not create a Family Hub account, you can safely ignore this email.',
  ].join('\n');

  const html = buildFamilyHubEmailHtml({
    title: 'Confirm your Family Hub email',
    preheader: 'Tap below to confirm your email — works even if your old link expired.',
    greeting,
    paragraphs: [
      'Please confirm your email address to finish setting up your <strong>Summit Family Hub</strong> account.',
      'If your previous confirmation link expired, <strong>this new link will work</strong>.',
      'After confirming, you can sign in anytime while your account awaits staff approval.',
    ],
    ctaLabel: 'Confirm Email Address',
    ctaUrl: actionLink,
    footerNote: 'If you did not create a Family Hub account, you can safely ignore this email.',
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

  console.log('Confirmation email sent', { to, resendId: result?.id });
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
    const payload = await req.json() as ConfirmPayload;
    const email = String(payload.email || '').trim().toLowerCase();
    const redirectTo = String(payload.redirectTo || CONFIRM_REDIRECT_URL).trim() || CONFIRM_REDIRECT_URL;

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

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('first_name')
      .eq('email', email)
      .maybeSingle();

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'signup',
      email,
      options: {
        redirectTo,
      },
    });

    if (error || !data?.properties?.action_link) {
      console.log('Confirmation email skipped (account may not exist or is already confirmed):', error?.message || 'missing action_link');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { subject, text, html } = buildConfirmEmail(
      email,
      data.properties.action_link,
      profile?.first_name || '',
    );
    const result = await sendWithResend(email, subject, text, html);

    return new Response(JSON.stringify({ ok: true, to: email, result }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('send-confirmation-email error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});