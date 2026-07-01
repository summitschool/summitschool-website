import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildFamilyHubEmailHtml, escapeHtml, FAMILY_HUB_URL } from '../_shared/family-hub-email.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('APPROVAL_FROM_EMAIL') || 'Summit Church School <info@summitchurchschool.org>';
const GRADUATION_ADMIN_EMAIL = (
  Deno.env.get('GRADUATION_ADMIN_EMAIL')
  || Deno.env.get('ENROLLMENT_SIGNATURE_EMAIL')
  || 'info@summitchurchschool.org'
).toLowerCase();
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type WorkflowBody = {
  action?: string;
  submission_id?: string;
  student_name?: string;
  school_year?: string;
  family_user_id?: string;
  guest_email?: string;
  guest_token?: string;
  payload?: Record<string, unknown>;
  admin_notes?: string;
};

async function sendEmail(to: string, subject: string, text: string, html: string) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set; skipping email');
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, text, html }),
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result?.message || 'Resend failed');
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json() as WorkflowBody;
    const action = String(body.action || '').trim();
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (action === 'family_submitted') {
      const name = body.student_name || 'A graduate';
      const year = body.school_year || '';
      const subject = `Graduation order submitted — ${name}`;
      const text = `${name} submitted a graduation order for ${year}. Review it in the Family Hub Admin → Graduation section.`;
      const html = buildFamilyHubEmailHtml({
        title: 'Graduation order submitted',
        preheader: `${name} submitted a graduation order.`,
        paragraphs: [
          `<strong>${escapeHtml(name)}</strong> submitted a senior graduation order for <strong>${escapeHtml(year)}</strong>.`,
          'Open the Family Hub Admin Graduation roster to review payment and approve the order.',
        ],
        ctaLabel: 'Open Family Hub',
        ctaUrl: FAMILY_HUB_URL,
        footerNote: 'Summit Church School graduation workflow',
      });
      await sendEmail(GRADUATION_ADMIN_EMAIL, subject, text, html);
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'admin_approved') {
      let to = body.guest_email || '';
      if (!to && body.family_user_id) {
        const { data: profile } = await admin.from('profiles').select('email').eq('id', body.family_user_id).maybeSingle();
        to = profile?.email || '';
      }
      if (to) {
        const name = body.student_name || 'your graduate';
        const year = body.school_year || '';
        const subject = `Graduation order approved — ${name}`;
        const text = `Your graduation order for ${name} (${year}) has been approved. A signed copy is in My Documents.`;
        const html = buildFamilyHubEmailHtml({
          title: 'Graduation order approved',
          preheader: `Your graduation order for ${name} is approved.`,
          paragraphs: [
            `Your graduation order for <strong>${escapeHtml(name)}</strong> (${escapeHtml(year)}) has been reviewed and approved.`,
            'A signed PDF is now available in <strong>My Documents</strong> in the Family Hub.',
          ],
          ctaLabel: 'Open Family Hub',
          ctaUrl: FAMILY_HUB_URL,
          footerNote: 'Contact the school office if you have questions about ceremony details.',
        });
        await sendEmail(to, subject, text, html);
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'changes_requested') {
      let to = body.guest_email || '';
      if (!to && body.family_user_id) {
        const { data: profile } = await admin.from('profiles').select('email').eq('id', body.family_user_id).maybeSingle();
        to = profile?.email || '';
      }
      const name = body.student_name || 'your graduate';
      const year = body.school_year || '';
      const note = String(body.admin_notes || '').trim();
      if (to) {
        const subject = `Graduation order — changes requested for ${name}`;
        const text = [
          `Hello,`,
          '',
          `We reviewed the graduation order for ${name} (${year}) and need a few updates before we can approve it.`,
          '',
          note ? `Requested changes: ${note}` : '',
          '',
          'Please open the Graduation Hub from My Tasks, make the updates, and submit again.',
          '',
          'Summit Church School',
        ].filter(Boolean).join('\n');
        const html = buildFamilyHubEmailHtml({
          title: 'Graduation order — changes requested',
          preheader: `Please update ${name}'s graduation order and resubmit.`,
          paragraphs: [
            `We reviewed the graduation order for <strong>${escapeHtml(name)}</strong> (${escapeHtml(year)}) and need a few updates before approval.`,
            note ? `<strong>Requested changes:</strong><br>${escapeHtml(note).replace(/\n/g, '<br>')}` : 'Please review your order and resubmit.',
            'Open the <strong>Graduation Hub</strong> from My Tasks, make the updates, and submit again.',
          ],
          ctaLabel: 'Open Family Hub',
          ctaUrl: FAMILY_HUB_URL,
          footerNote: 'Contact the school office if you have questions.',
        });
        await sendEmail(to, subject, text, html);
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'guest_upsert' && body.guest_token && body.payload) {
      const { data: guests } = await admin.rpc('get_graduation_guest_by_token', { p_token: body.guest_token });
      const guest = Array.isArray(guests) ? guests[0] : guests;
      if (!guest?.id) {
        return new Response(JSON.stringify({ ok: false, error: 'Invalid guest token' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const payload = body.payload as Record<string, unknown>;
      const { data: existing } = await admin
        .from('graduation_submissions')
        .select('id')
        .eq('guest_id', guest.id)
        .eq('school_year', guest.school_year)
        .maybeSingle();

      const row = {
        ...payload,
        school_year: guest.school_year,
        participant_type: 'guest',
        guest_id: guest.id,
        family_user_id: null,
        student_id: null,
        updated_at: new Date().toISOString(),
      };

      if (existing?.id) {
        const { data, error } = await admin.from('graduation_submissions').update(row).eq('id', existing.id).select('*').single();
        if (error) throw error;
        return new Response(JSON.stringify({ ok: true, submission: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data, error } = await admin.from('graduation_submissions').insert(row).select('*').single();
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, submission: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: true, skipped: action || 'unknown' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('graduation-workflow error:', error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});