import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildFamilyHubEmailHtml, escapeHtml, FAMILY_HUB_URL } from '../_shared/family-hub-email.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('APPROVAL_FROM_EMAIL') || 'Summit Church School <info@summitchurchschool.org>';
const WEBHOOK_SECRET = Deno.env.get('TASK_VISIBILITY_WEBHOOK_SECRET') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const GRAD_URL_PREFIX = 'hub://graduation/';
const KG_URL_PREFIX = 'hub://kindergarten-graduation/';
const PROGRESS_URL_PREFIX = 'hub://progress-report/';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type DocRow = {
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
  task_notified_at: string | null;
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

function studentLabelFromTitle(title: string, prefixPattern: RegExp) {
  return String(title || 'your student').replace(prefixPattern, '').trim() || 'your student';
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

function buildSeniorGraduationEmail(studentLabel: string, dueDate: string | null) {
  const dueText = formatDueLabel(dueDate);
  const subject = `Senior graduation order ready — ${studentLabel}`;
  const text = [
    'Hello,',
    '',
    `Now that first semester grades are submitted, ${studentLabel}'s senior graduation order is ready in My Tasks.`,
    `Open the Graduation Hub to complete cap & gown sizing, fees, and payment. Due ${dueText}.`,
    '',
    `Open My Tasks: ${FAMILY_HUB_URL}`,
    '',
    'Summit Church School',
  ].join('\n');
  const html = buildFamilyHubEmailHtml({
    title: 'Senior graduation order task',
    preheader: `${studentLabel}'s graduation order is ready in My Tasks.`,
    paragraphs: [
      `Now that first semester grades are submitted, <strong>${escapeHtml(studentLabel)}</strong>'s <strong>senior graduation order</strong> is in <strong>My Tasks</strong>.`,
      `Open the Graduation Hub from the task card to complete cap &amp; gown sizing, fees, and payment by <strong>${escapeHtml(dueText)}</strong>.`,
    ],
    ctaLabel: 'Open Family Hub',
    ctaUrl: FAMILY_HUB_URL,
    footerNote: 'You received this because a graduation order task was added for your family.',
  });
  return { subject, text, html };
}

function buildKindergartenGraduationEmail(studentLabel: string, dueDate: string | null) {
  const dueText = formatDueLabel(dueDate);
  const subject = `Kindergarten graduation task ready — ${studentLabel}`;
  const text = [
    'Hello,',
    '',
    `${studentLabel}'s kindergarten graduation order task is now in My Tasks.`,
    'The school will publish full order details in the Family Hub soon. Watch My Tasks for the Kindergarten Graduation Hub link.',
    dueDate ? `Order due ${dueText}.` : '',
    '',
    `Open My Tasks: ${FAMILY_HUB_URL}`,
    '',
    'Summit Church School',
  ].filter(Boolean).join('\n');
  const html = buildFamilyHubEmailHtml({
    title: 'Kindergarten graduation task',
    preheader: `${studentLabel}'s kindergarten graduation task is ready in My Tasks.`,
    paragraphs: [
      `<strong>${escapeHtml(studentLabel)}</strong>'s <strong>kindergarten graduation order</strong> task is now in <strong>My Tasks</strong>.`,
      'The school will publish full order details in the Family Hub soon. Open My Tasks for the Kindergarten Graduation Hub link when you are ready to review requirements.',
      dueDate ? `Orders are due by <strong>${escapeHtml(dueText)}</strong>.` : '',
    ].filter(Boolean),
    ctaLabel: 'Open Family Hub',
    ctaUrl: FAMILY_HUB_URL,
    footerNote: 'You received this because a kindergarten graduation task was added for your family.',
  });
  return { subject, text, html };
}

async function loadEmails(admin: ReturnType<typeof createClient>, userIds: string[]) {
  const emailsByUser = new Map<string, string>();
  if (!userIds.length) return emailsByUser;
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, email')
    .in('id', userIds);
  (profiles || []).forEach((profile) => {
    if (profile.email) emailsByUser.set(profile.id, profile.email);
  });
  return emailsByUser;
}

async function processProgressReportTasks(
  admin: ReturnType<typeof createClient>,
  userId: string | undefined,
  today: string,
) {
  let query = admin
    .from('family_documents')
    .select(`
      id, user_id, title, url, school_year, due_date_1, due_date_2,
      visible_from_1, visible_from_2, notified_semester_1_at, notified_semester_2_at
    `)
    .ilike('category', '%progress report%')
    .ilike('category', '%task%');
  if (userId) query = query.eq('user_id', userId);

  const { data: tasks, error } = await query;
  if (error) throw error;
  if (!tasks?.length) return 0;

  const studentIds = tasks
    .map((task) => {
      const url = String(task.url || '');
      if (!url.startsWith(PROGRESS_URL_PREFIX)) return null;
      return url.slice(PROGRESS_URL_PREFIX.length).trim() || null;
    })
    .filter(Boolean) as string[];

  const yearsByStudent = new Map<string, { semester_1_locked: boolean; semester_2_locked: boolean }>();
  if (studentIds.length) {
    const { data: years } = await admin
      .from('student_school_years')
      .select('student_id, school_year, entry_type, semester_1_locked, semester_2_locked')
      .in('student_id', [...new Set(studentIds)])
      .eq('entry_type', 'current');
    (years || []).forEach((year) => {
      yearsByStudent.set(`${year.student_id}:${year.school_year}`, {
        semester_1_locked: Boolean(year.semester_1_locked),
        semester_2_locked: Boolean(year.semester_2_locked),
      });
    });
  }

  const emailsByUser = await loadEmails(admin, [...new Set(tasks.map((t) => t.user_id))]);
  let sent = 0;

  for (const task of tasks) {
    const email = emailsByUser.get(task.user_id);
    if (!email) continue;

    const studentId = String(task.url || '').startsWith(PROGRESS_URL_PREFIX)
      ? String(task.url).slice(PROGRESS_URL_PREFIX.length).trim()
      : null;
    const year = studentId && task.school_year
      ? yearsByStudent.get(`${studentId}:${task.school_year}`)
      : null;

    const studentLabel = studentLabelFromTitle(task.title, /^Progress Report —\s*/i);
    const s1Eligible = task.visible_from_1
      && task.visible_from_1 <= today
      && !year?.semester_1_locked
      && !task.notified_semester_1_at;
    const s2Eligible = task.visible_from_2
      && task.visible_from_2 <= today
      && year?.semester_1_locked
      && !year?.semester_2_locked
      && !task.notified_semester_2_at;

    if (s1Eligible) {
      const mail = buildProgressReportEmail(studentLabel, '1', task.due_date_1);
      await sendEmail(email, mail.subject, mail.text, mail.html);
      await admin.from('family_documents').update({
        notified_semester_1_at: new Date().toISOString(),
      }).eq('id', task.id);
      sent += 1;
    } else if (s2Eligible) {
      const mail = buildProgressReportEmail(studentLabel, '2', task.due_date_2);
      await sendEmail(email, mail.subject, mail.text, mail.html);
      await admin.from('family_documents').update({
        notified_semester_2_at: new Date().toISOString(),
      }).eq('id', task.id);
      sent += 1;
    }
  }

  return sent;
}

async function processHubTaskNotifications(
  admin: ReturnType<typeof createClient>,
  userId: string | undefined,
  urlPrefix: string,
  kind: 'senior_graduation' | 'kindergarten_graduation',
) {
  let query = admin
    .from('family_documents')
    .select('id, user_id, title, url, due_date_1, task_notified_at')
    .ilike('category', '%task%')
    .like('url', `${urlPrefix}%`)
    .is('task_notified_at', null);
  if (userId) query = query.eq('user_id', userId);

  const { data: tasks, error } = await query;
  if (error) throw error;
  if (!tasks?.length) return 0;

  const emailsByUser = await loadEmails(admin, [...new Set(tasks.map((t) => t.user_id))]);
  let sent = 0;

  for (const task of tasks) {
    const email = emailsByUser.get(task.user_id);
    if (!email) continue;

    const titlePrefix = kind === 'senior_graduation'
      ? /^Graduation Order —\s*/i
      : /^Kindergarten Graduation —\s*/i;
    const studentLabel = studentLabelFromTitle(task.title, titlePrefix);
    const mail = kind === 'senior_graduation'
      ? buildSeniorGraduationEmail(studentLabel, task.due_date_1)
      : buildKindergartenGraduationEmail(studentLabel, task.due_date_1);

    await sendEmail(email, mail.subject, mail.text, mail.html);
    await admin.from('family_documents').update({
      task_notified_at: new Date().toISOString(),
    }).eq('id', task.id);
    sent += 1;
  }

  return sent;
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
    const progressSent = await processProgressReportTasks(admin, userId || undefined, today);
    const gradSent = await processHubTaskNotifications(admin, userId || undefined, GRAD_URL_PREFIX, 'senior_graduation');
    const kgSent = await processHubTaskNotifications(admin, userId || undefined, KG_URL_PREFIX, 'kindergarten_graduation');
    const sent = progressSent + gradSent + kgSent;

    return new Response(JSON.stringify({
      ok: true,
      sent,
      progress_sent: progressSent,
      graduation_sent: gradSent,
      kindergarten_sent: kgSent,
    }), {
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