import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildFamilyHubEmailHtml, escapeHtml } from '../_shared/family-hub-email.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('APPROVAL_FROM_EMAIL') || 'Summit Church School <info@summitchurchschool.org>';
const DEFAULT_FULL_ADMIN_EMAILS = ['sjesimon@gmail.com', 'summitchurchschool@gmail.com'];
const extraAdminEmail = (Deno.env.get('FULL_ADMIN_EMAIL') || '').trim().toLowerCase();
const ADMIN_EMAILS = new Set([
  ...DEFAULT_FULL_ADMIN_EMAILS,
  ...(extraAdminEmail ? [extraAdminEmail] : []),
]);

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type DistrictNoticePayload = {
  to?: string;
  type?: string;
  letter_text?: string;
  district?: string;
  contact_name?: string;
  school_name?: string;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function letterToHtml(letterText: string) {
  return `<div style="text-align:left;margin:0 auto;max-width:420px;font-size:15px;line-height:1.7;color:#334155;white-space:pre-wrap;">${escapeHtml(letterText)}</div>`;
}

function buildEmail(payload: DistrictNoticePayload) {
  const isEnroll = payload.type === 'enroll';
  const letterText = String(payload.letter_text || '').trim();
  const title = isEnroll ? 'Students now enrolled' : 'Student withdrawal notice';
  const subject = isEnroll
    ? 'Students now enrolled at Summit Church School'
    : 'Student withdrawal notice from Summit Church School';
  const preheader = isEnroll
    ? 'The following students are now enrolled at Summit Church School.'
    : 'The following students are no longer enrolled at Summit Church School.';

  const html = buildFamilyHubEmailHtml({
    title,
    preheader,
    paragraphs: [],
    extraHtml: letterToHtml(letterText),
    footerNote: 'Summit Church School • Rainbow City, Alabama • 256-328-3966',
  });

  return { subject, text: letterText, html };
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
      reply_to: ['info@summitchurchschool.org'],
      subject,
      text,
      html,
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result?.message || result?.error || 'Resend API request failed');
  }
  return result;
}

async function isAuthorized(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.replace('Bearer ', '').trim();
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user?.email || !user.id) return false;

  if (ADMIN_EMAILS.has(user.email.toLowerCase())) return true;

  const { data: staffMember } = await supabaseAdmin
    .from('staff_members')
    .select('admin_sections')
    .eq('user_id', user.id)
    .maybeSingle();

  const sections = Array.isArray(staffMember?.admin_sections) ? staffMember.admin_sections : [];
  return sections.includes('families') || sections.includes('academic') || sections.includes('districts');
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
      error: 'Unauthorized. Sign in as an admin to send district notices.',
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload = await req.json() as DistrictNoticePayload;
    const to = String(payload.to || '').trim().toLowerCase();
    const letterText = String(payload.letter_text || '').trim();
    const type = payload.type === 'enroll' ? 'enroll' : 'return';

    if (!isValidEmail(to)) {
      return new Response(JSON.stringify({ ok: false, error: 'Enter a valid district email address.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!letterText) {
      return new Response(JSON.stringify({ ok: false, error: 'The letter is empty. Select students first.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { subject, text, html } = buildEmail({ ...payload, type, letter_text: letterText });
    const result = await sendWithResend(to, subject, text, html);

    return new Response(JSON.stringify({ ok: true, to, result }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('send-district-notice error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
