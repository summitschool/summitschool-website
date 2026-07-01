import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildFamilyHubEmailHtml, escapeHtml, FAMILY_HUB_URL } from '../_shared/family-hub-email.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('APPROVAL_FROM_EMAIL') || 'Summit Church School <info@summitchurchschool.org>';
const WEBHOOK_SECRET = Deno.env.get('TASK_VISIBILITY_WEBHOOK_SECRET') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type TaskRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  url: string;
  school_year: string | null;
  due_date_1: string | null;
  due_date_2: string | null;
  visible_from_1: string | null;
  visible_from_2: string | null;
  notified_semester_1_at: string | null;
  notified_semester_2_at: string | null;
  student_id: string | null;
  semester_1_locked: boolean | null;
  semester_2_locked: boolean | null;
  email: string | null;
};

function todayIso() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDueLabel(isoDate: string | null) {
  if (!isoDate) return 'the due date shown in My Tasks';
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

async function sendEmail(to: string, subject: string, text: string, html: string) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set; skipping email');
    return false;
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
  return true;
}

function buildProgressReportEmail(studentLabel: string, semester: '1' | '2', dueDate: string | null) {
  const semesterLabel = semester === '1' ? 'first semester' : 'second semester';
  const dueText = formatDueLabel(dueDate);
  const subject = `Progress report task ready — ${studentLabel}`;
  const text = [
    'Hello,',
    '',
    `A ${semesterLabel} progress report task for ${studentLabel} is now in your Family Hub My Tasks.`,
    `Please enter grades and attendance in Academic Records. Due ${dueText}.`,
    '',
    `Open My Tasks: ${FAMILY_HUB_URL}`,
    '',
    'Summit Church School',
  ].join('\n');
  const html = buildFamilyHubEmailHtml({
    title: 'New progress report task',
    preheader: `${semesterLabel} progress report for ${studentLabel} is ready in My Tasks.`,
    paragraphs: [
      `A <strong>${escapeHtml(semesterLabel)}</strong> progress report task for <strong>${escapeHtml(studentLabel)}</strong> is now in <strong>My Tasks</strong>.`,
      `Open Academic Records from the task card, enter grades and attendance, and submit by <strong>${escapeHtml(dueText)}</strong>.`,
    ],
    ctaLabel: 'Open Family Hub',
    ctaUrl: FAMILY_HUB_URL,
    footerNote: 'You received this because a scheduled progress report task became available for your family.',
  });
  return { subject, text, html };
}

async function fetchCandidateTasks(admin: ReturnType<typeof createClient>, userId?: string) {
  let query = admin
    .from('family_documents')
    .select(`
      id,
      user_id,
      title,
      description,
      url,
      school_year,
      due_date_1,
      due_date_2,
      visible_from_1,
      visible_from_2,
      notified_semester_1_at,
      notified_semester_2_at
    `)
    .ilike('category', '%progress report%')
    .ilike('category', '%task%');

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data: tasks, error } = await query;
  if (error) throw error;
  if (!tasks?.length) return [] as TaskRow[];

  const studentIds = tasks
    .map((task) => {
      const url = String(task.url || '');
      if (!url.startsWith('hub://progress-report/')) return null;
      return url.slice('hub://progress-report/'.length).trim() || null;
    })
    .filter(Boolean) as string[];

  const uniqueStudentIds = [...new Set(studentIds)];
  const yearsByStudent = new Map<string, { semester_1_locked: boolean; semester_2_locked: boolean }>();
  if (uniqueStudentIds.length) {
    const { data: years } = await admin
      .from('student_school_years')
      .select('student_id, school_year, entry_type, semester_1_locked, semester_2_locked')
      .in('student_id', uniqueStudentIds)
      .eq('entry_type', 'current');
    (years || []).forEach((year) => {
      const key = `${year.student_id}:${year.school_year}`;
      yearsByStudent.set(key, {
        semester_1_locked: Boolean(year.semester_1_locked),
        semester_2_locked: Boolean(year.semester_2_locked),
      });
    });
  }

  const userIds = [...new Set(tasks.map((task) => task.user_id))];
  const emailsByUser = new Map<string, string>();
  if (userIds.length) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, email')
      .in('id', userIds);
    (profiles || []).forEach((profile) => {
      if (profile.email) emailsByUser.set(profile.id, profile.email);
    });
  }

  const today = todayIso();
  return tasks.map((task) => {
    const studentId = String(task.url || '').startsWith('hub://progress-report/')
      ? String(task.url).slice('hub://progress-report/'.length).trim()
      : null;
    const yearKey = studentId && task.school_year ? `${studentId}:${task.school_year}` : '';
    const year = yearKey ? yearsByStudent.get(yearKey) : null;
    return {
      ...task,
      student_id: studentId,
      semester_1_locked: year?.semester_1_locked ?? null,
      semester_2_locked: year?.semester_2_locked ?? null,
      email: emailsByUser.get(task.user_id) || null,
      _today: today,
    } as TaskRow & { _today: string };
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({})) as { action?: string; user_id?: string };
    const action = String(body.action || 'scan').trim();
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let userId = body.user_id ? String(body.user_id).trim() : '';
    if (action === 'scan_user') {
      const authHeader = req.headers.get('Authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (!token) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: { user }, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !user) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = user.id;
    } else {
      const secret = req.headers.get('x-webhook-secret') || '';
      if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
        return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const today = todayIso();
    const rows = await fetchCandidateTasks(admin, userId || undefined);
    let sent = 0;

    for (const row of rows as (TaskRow & { _today?: string })[]) {
      if (!row.email) continue;

      const studentLabel = String(row.title || 'your student').replace(/^Progress Report —\s*/i, '').trim() || 'your student';
      const s1Eligible = row.visible_from_1
        && row.visible_from_1 <= today
        && !row.semester_1_locked
        && !row.notified_semester_1_at;
      const s2Eligible = row.visible_from_2
        && row.visible_from_2 <= today
        && row.semester_1_locked
        && !row.semester_2_locked
        && !row.notified_semester_2_at;

      if (s1Eligible) {
        const mail = buildProgressReportEmail(studentLabel, '1', row.due_date_1);
        await sendEmail(row.email, mail.subject, mail.text, mail.html);
        await admin.from('family_documents').update({
          notified_semester_1_at: new Date().toISOString(),
        }).eq('id', row.id);
        sent += 1;
      } else if (s2Eligible) {
        const mail = buildProgressReportEmail(studentLabel, '2', row.due_date_2);
        await sendEmail(row.email, mail.subject, mail.text, mail.html);
        await admin.from('family_documents').update({
          notified_semester_2_at: new Date().toISOString(),
        }).eq('id', row.id);
        sent += 1;
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, checked: rows.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('notify-task-visibility error:', error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});