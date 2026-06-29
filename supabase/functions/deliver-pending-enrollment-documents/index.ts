import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { deliverPendingEnrollmentDocuments } from '../_shared/deliver-pending-enrollment-documents.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const WEBHOOK_SECRET = Deno.env.get('ENROLLMENT_DELIVERY_WEBHOOK_SECRET')
  || Deno.env.get('APPROVAL_EMAIL_WEBHOOK_SECRET');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type DeliveryPayload = {
  email?: string;
  user_id?: string;
};

function isAuthorized(req: Request) {
  if (!WEBHOOK_SECRET) return false;
  return req.headers.get('x-webhook-secret') === WEBHOOK_SECRET;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Unauthorized webhook',
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload = await req.json() as DeliveryPayload;
    const familyEmail = String(payload.email || '').trim().toLowerCase();

    if (!familyEmail) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await deliverPendingEnrollmentDocuments({
      supabaseUrl: SUPABASE_URL,
      supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      familyEmail,
      familyUserId: payload.user_id ? String(payload.user_id) : undefined,
    });

    return new Response(JSON.stringify({
      ok: true,
      email: familyEmail,
      ...result,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('deliver-pending-enrollment-documents error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});