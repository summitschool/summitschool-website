import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');

type NotifyPayload = {
  type: 'member_approval' | 'id_approval';
  record?: Record<string, unknown>;
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatMemberApprovalMessage(record: Record<string, unknown>) {
  const name = [record.first_name, record.last_name].filter(Boolean).join(' ')
    || record.full_name
    || 'Unknown';
  const email = record.email || 'No email';
  const signedUp = record.created_at
    ? new Date(String(record.created_at)).toLocaleString('en-US', { timeZone: 'America/Chicago' })
    : 'Unknown';

  return [
    '<b>New member awaiting approval</b>',
    '',
    `<b>Name:</b> ${escapeHtml(name)}`,
    `<b>Email:</b> ${escapeHtml(email)}`,
    `<b>Signed up:</b> ${escapeHtml(signedUp)}`,
    '',
    'Review in Members → Admin → Members.',
  ].join('\n');
}

function formatIdApprovalMessage(record: Record<string, unknown>) {
  const ackName = record.ack_name || 'Not provided';
  const userId = record.user_id || 'Unknown user';
  const submitted = record.created_at
    ? new Date(String(record.created_at)).toLocaleString('en-US', { timeZone: 'America/Chicago' })
    : 'Unknown';

  return [
    '<b>New government ID awaiting review</b>',
    '',
    `<b>User ID:</b> <code>${escapeHtml(userId)}</code>`,
    `<b>Acknowledged by:</b> ${escapeHtml(ackName)}`,
    `<b>Submitted:</b> ${escapeHtml(submitted)}`,
    '',
    'Review in Members → Admin → Members → Pending ID Uploads.',
  ].join('\n');
}

function formatMessage(payload: NotifyPayload) {
  const record = payload.record || {};

  if (payload.type === 'member_approval') {
    return formatMemberApprovalMessage(record);
  }

  if (payload.type === 'id_approval') {
    return formatIdApprovalMessage(record);
  }

  return '<b>Summit Church School alert</b>\n\nUnrecognized notification type.';
}

async function sendTelegramMessage(text: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set on the Edge Function.');
  }

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(result?.description || 'Telegram API request failed');
  }

  return result;
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

  if (WEBHOOK_SECRET) {
    const providedSecret = req.headers.get('x-webhook-secret');
    if (providedSecret !== WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  try {
    const payload = await req.json() as NotifyPayload;
    const message = formatMessage(payload);
    const result = await sendTelegramMessage(message);

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('telegram-notify error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});