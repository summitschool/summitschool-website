import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

  const html = `
    <div style="margin:0;padding:32px 16px;background:#F8F6F1;font-family:Inter,Arial,sans-serif;color:#334155;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;">
        <tr>
          <td style="padding:32px 32px 16px;text-align:center;">
            <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#8B9A7B;font-weight:600;">Summit Church School</p>
            <h1 style="margin:0;font-family:Georgia,serif;font-size:28px;line-height:1.2;color:#1B365D;">Reset your Family Hub password</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 24px;text-align:center;">
            <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#475569;">
              We received a request to reset the password for <strong>${escapeHtml(email)}</strong>.
            </p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#64748b;">
              Click below to choose a new password. This link expires soon and can only be used once.
            </p>
            <a href="${escapeHtml(actionLink)}"
               style="display:inline-block;padding:14px 28px;background:#1B365D;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;border-radius:16px;">
              Reset Password
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 32px;">
            <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;text-align:center;">
              If you did not request a password reset, you can safely ignore this email.
            </p>
          </td>
        </tr>
      </table>
    </div>
  `.trim();

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