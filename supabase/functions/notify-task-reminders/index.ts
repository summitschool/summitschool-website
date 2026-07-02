import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  ADMIN_EMAIL,
  buildAdminReminderEmail,
  buildFamilyReminderEmail,
  buildOnboardingBundleAdminEmail,
  buildOnboardingBundleEmail,
  PREVIEW_EMAIL,
  PREVIEW_VARIANTS,
  SAMPLE_ONBOARDING_BUNDLE_ITEMS,
  type OnboardingBundleItem,
  type OnboardingBundleKind,
  type ReminderSlot,
  type TaskKind,
} from '../_shared/task-reminder-email.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('APPROVAL_FROM_EMAIL') || 'Summit Church School <info@summitchurchschool.org>';
const WEBHOOK_SECRET = Deno.env.get('TASK_REMINDER_WEBHOOK_SECRET') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const REMINDERS_LIVE = (Deno.env.get('TASK_REMINDERS_LIVE') || 'false').toLowerCase() === 'true';
const ADMIN_NOTIFY_EMAIL = Deno.env.get('TASK_REMINDER_ADMIN_EMAIL') || ADMIN_EMAIL;

const ONBOARDING_URL = 'hub://onboarding';
const PROGRESS_URL_PREFIX = 'hub://progress-report/';
const GRAD_URL_PREFIX = 'hub://graduation/';
const KG_URL_PREFIX = 'hub://kindergarten-graduation/';

const ONBOARDING_BUNDLE_SLOT_PRIORITY: ReminderSlot[] = ['overdue2', 'due', 'day7', 'day3'];
const PROGRESS_STANDARD_SLOTS: ReminderSlot[] = ['days15', 'days10', 'days3', 'due', 'overdue2'];
const SENIOR_SCHEDULE_SLOTS: ReminderSlot[] = ['days10', 'days5', 'days3', 'due', 'overdue1'];
const SENIOR_ADMIN_SLOTS: ReminderSlot[] = ['admin_days3', 'admin_due'];

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
  category: string | null;
  school_year: string | null;
  due_date_1: string | null;
  due_date_2: string | null;
  visible_from_1: string | null;
  visible_from_2: string | null;
  created_at: string;
};

type YearRow = {
  semester_1_locked: boolean;
  semester_2_locked: boolean;
};

type StudentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  current_grade_level: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
};

function todayIso() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysIso(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function createdAtDate(createdAt: string) {
  return String(createdAt || '').slice(0, 10);
}

function slotTriggersToday(slot: ReminderSlot, anchors: { created?: string; due?: string | null }) {
  const today = todayIso();
  switch (slot) {
    case 'day3':
      return anchors.created ? today === addDaysIso(anchors.created, 3) : false;
    case 'day7':
      return anchors.created ? today === addDaysIso(anchors.created, 7) : false;
    case 'days15':
      return anchors.due ? today === addDaysIso(anchors.due, -15) : false;
    case 'days10':
      return anchors.due ? today === addDaysIso(anchors.due, -10) : false;
    case 'days5':
      return anchors.due ? today === addDaysIso(anchors.due, -5) : false;
    case 'days3':
      return anchors.due ? today === addDaysIso(anchors.due, -3) : false;
    case 'due':
      return anchors.due ? today === anchors.due : false;
    case 'overdue1':
      return anchors.due ? today === addDaysIso(anchors.due, 1) : false;
    case 'overdue2':
      return anchors.due ? today === addDaysIso(anchors.due, 2) : false;
    case 'admin_days3':
      return anchors.due ? today === addDaysIso(anchors.due, -3) : false;
    case 'admin_due':
      return anchors.due ? today === anchors.due : false;
    case 'admin_overdue':
      return anchors.due ? today > anchors.due : false;
    default:
      return false;
  }
}

function reminderKey(audience: 'family' | 'admin', slot: ReminderSlot, semester?: '1' | '2') {
  if (semester) return `${audience}:s${semester}:${slot}`;
  return `${audience}:${slot}`;
}

type ClassifiedKind = TaskKind | 'progress';

function isOnboardingKind(kind: ClassifiedKind | null): kind is OnboardingBundleKind {
  return kind === 'onboarding_checklist' || kind === 'coc' || kind === 'id_upload';
}

function formatFamilyName(profile: ProfileRow | null | undefined, fallbackEmail = '') {
  if (profile?.first_name && profile?.last_name) {
    return `${profile.first_name} ${profile.last_name}`.trim();
  }
  if (profile?.full_name) return String(profile.full_name).trim();
  if (fallbackEmail) return fallbackEmail.split('@')[0] || 'Family';
  return 'Family';
}

function classifyTask(task: DocRow): ClassifiedKind | null {
  const category = String(task.category || '').toLowerCase();
  if (!category.includes('task')) return null;

  const url = String(task.url || '');
  const title = String(task.title || '').toLowerCase();

  if (url === ONBOARDING_URL) return 'onboarding_checklist';
  if (title.includes('code of conduct')) return 'coc';
  if (title.includes('upload government issued id')) return 'id_upload';
  if (url.startsWith(PROGRESS_URL_PREFIX)) return 'progress';
  if (url.startsWith(GRAD_URL_PREFIX)) return 'senior_graduation';
  if (url.startsWith(KG_URL_PREFIX)) return 'kindergarten_graduation';
  return null;
}

function studentLabelFromTitle(title: string, prefixPattern: RegExp) {
  return String(title || 'Student').replace(prefixPattern, '').trim() || 'Student';
}

function studentDisplayName(student: StudentRow | null | undefined) {
  if (!student) return 'Student';
  return [student.first_name, student.last_name].filter(Boolean).join(' ').trim() || 'Student';
}

function isSeniorGrade(gradeLevel: string | null | undefined) {
  return String(gradeLevel || '').trim() === '12';
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

async function loadProfiles(admin: ReturnType<typeof createClient>, userIds: string[]) {
  const profilesByUser = new Map<string, ProfileRow>();
  if (!userIds.length) return profilesByUser;
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, email, first_name, last_name, full_name')
    .in('id', userIds);
  (profiles || []).forEach((profile) => profilesByUser.set(profile.id, profile));
  return profilesByUser;
}

async function loadSentKeys(admin: ReturnType<typeof createClient>, taskIds: string[]) {
  const sent = new Set<string>();
  if (!taskIds.length) return sent;
  const { data, error } = await admin
    .from('task_reminder_sent')
    .select('task_id, reminder_key')
    .in('task_id', taskIds);
  if (error) {
    if (String(error.message || '').includes('task_reminder_sent')) {
      console.warn('task_reminder_sent table missing; reminders will not dedupe until task-reminder-log.sql is run.');
      return sent;
    }
    throw error;
  }
  (data || []).forEach((row) => sent.add(`${row.task_id}:${row.reminder_key}`));
  return sent;
}

async function markSent(
  admin: ReturnType<typeof createClient>,
  taskId: string,
  key: string,
  recipient: string,
) {
  const { error } = await admin.from('task_reminder_sent').insert({
    task_id: taskId,
    reminder_key: key,
    recipient,
  });
  if (error && !String(error.message || '').includes('duplicate')) {
    throw error;
  }
}

type ProgressContext = {
  kind: 'progress_s1' | 'progress_s2';
  semester: '1' | '2';
  dueDate: string | null;
  studentLabel: string;
  isSenior: boolean;
};

function getProgressContext(
  task: DocRow,
  year: YearRow | null | undefined,
  student: StudentRow | null | undefined,
  today: string,
): ProgressContext | null {
  if (!year) return null;

  const studentLabel = studentLabelFromTitle(task.title, /^Progress Report —\s*/i);
  const senior = isSeniorGrade(student?.current_grade_level);

  if (!year.semester_1_locked && task.visible_from_1 && task.visible_from_1 <= today) {
    return {
      kind: 'progress_s1',
      semester: '1',
      dueDate: task.due_date_1,
      studentLabel,
      isSenior: senior,
    };
  }

  if (year.semester_1_locked && !year.semester_2_locked && task.visible_from_2 && task.visible_from_2 <= today) {
    return {
      kind: 'progress_s2',
      semester: '2',
      dueDate: task.due_date_2,
      studentLabel,
      isSenior: senior,
    };
  }

  return null;
}

function pickOnboardingBundleSlot(tasks: DocRow[]): ReminderSlot | null {
  for (const slot of ONBOARDING_BUNDLE_SLOT_PRIORITY) {
    const triggered = tasks.some((task) => slotTriggersToday(slot, {
      created: createdAtDate(task.created_at),
      due: task.due_date_1,
    }));
    if (triggered) return slot;
  }
  return null;
}

function onboardingAnchorTask(tasks: DocRow[]) {
  return tasks.find((task) => String(task.url || '') === ONBOARDING_URL) || tasks[0];
}

function toOnboardingBundleItem(task: DocRow, kind: OnboardingBundleKind): OnboardingBundleItem {
  return {
    kind,
    title: task.title,
    dueDate: task.due_date_1,
  };
}

async function processOnboardingBundles(
  admin: ReturnType<typeof createClient>,
  onboardingTasks: Array<{ task: DocRow; kind: OnboardingBundleKind }>,
  profilesByUser: Map<string, ProfileRow>,
  sentKeys: Set<string>,
) {
  let sent = 0;
  const tasksByUser = new Map<string, Array<{ task: DocRow; kind: OnboardingBundleKind }>>();

  onboardingTasks.forEach((entry) => {
    const list = tasksByUser.get(entry.task.user_id) || [];
    list.push(entry);
    tasksByUser.set(entry.task.user_id, list);
  });

  for (const [userId, entries] of tasksByUser) {
    const tasks = entries.map((entry) => entry.task);
    const bundleItems = entries.map((entry) => toOnboardingBundleItem(entry.task, entry.kind));
    const profile = profilesByUser.get(userId);
    const familyEmail = profile?.email || '';
    const familyName = formatFamilyName(profile, familyEmail);
    const anchor = onboardingAnchorTask(tasks);
    if (!anchor) continue;

    const slot = pickOnboardingBundleSlot(tasks);
    if (slot) {
      const key = `family:onboarding_bundle:${slot}`;
      if (!sentKeys.has(`${anchor.id}:${key}`) && familyEmail) {
        const mail = buildOnboardingBundleEmail({ slot, items: bundleItems });
        await sendEmail(familyEmail, mail.subject, mail.text, mail.html);
        await markSent(admin, anchor.id, key, familyEmail);
        sentKeys.add(`${anchor.id}:${key}`);
        sent += 1;
      }
    }

    const hasOverdue = tasks.some((task) => slotTriggersToday('admin_overdue', {
      created: createdAtDate(task.created_at),
      due: task.due_date_1,
    }));
    if (hasOverdue) {
      const key = 'admin:onboarding_bundle:overdue';
      if (!sentKeys.has(`${anchor.id}:${key}`)) {
        const overdueItems = bundleItems.filter((item) => item.dueDate && todayIso() > item.dueDate);
        const mail = buildOnboardingBundleAdminEmail({
          familyName,
          familyEmail: familyEmail || 'unknown',
          items: overdueItems.length ? overdueItems : bundleItems,
        });
        await sendEmail(ADMIN_NOTIFY_EMAIL, mail.subject, mail.text, mail.html);
        await markSent(admin, anchor.id, key, ADMIN_NOTIFY_EMAIL);
        sentKeys.add(`${anchor.id}:${key}`);
        sent += 1;
      }
    }
  }

  return sent;
}

async function graduationIncomplete(
  admin: ReturnType<typeof createClient>,
  studentId: string,
  schoolYear: string | null,
  kind: 'senior_graduation' | 'kindergarten_graduation',
) {
  const table = kind === 'senior_graduation'
    ? 'graduation_submissions'
    : 'kindergarten_graduation_submissions';
  const { data } = await admin
    .from(table)
    .select('status')
    .eq('student_id', studentId)
    .eq('school_year', schoolYear || '')
    .maybeSingle();
  return !data || data.status !== 'approved';
}

async function processTaskReminders(admin: ReturnType<typeof createClient>, today: string) {
  const { data: tasks, error } = await admin
    .from('family_documents')
    .select(`
      id, user_id, title, description, url, category, school_year,
      due_date_1, due_date_2, visible_from_1, visible_from_2, created_at
    `)
    .ilike('category', '%task%');
  if (error) throw error;
  if (!tasks?.length) return { sent: 0, skipped_live_gate: !REMINDERS_LIVE };

  const progressStudentIds = tasks
    .map((task) => {
      const url = String(task.url || '');
      if (!url.startsWith(PROGRESS_URL_PREFIX)) return null;
      return url.slice(PROGRESS_URL_PREFIX.length).trim() || null;
    })
    .filter(Boolean) as string[];

  const gradStudentIds = tasks
    .map((task) => {
      const url = String(task.url || '');
      if (url.startsWith(GRAD_URL_PREFIX)) return url.slice(GRAD_URL_PREFIX.length).trim() || null;
      if (url.startsWith(KG_URL_PREFIX)) return url.slice(KG_URL_PREFIX.length).trim() || null;
      return null;
    })
    .filter(Boolean) as string[];

  const allStudentIds = [...new Set([...progressStudentIds, ...gradStudentIds])];
  const studentsById = new Map<string, StudentRow>();
  if (allStudentIds.length) {
    const { data: students } = await admin
      .from('students')
      .select('id, first_name, last_name, current_grade_level')
      .in('id', allStudentIds);
    (students || []).forEach((student) => studentsById.set(student.id, student));
  }

  const yearsByStudent = new Map<string, YearRow>();
  if (progressStudentIds.length) {
    const { data: years } = await admin
      .from('student_school_years')
      .select('student_id, school_year, entry_type, semester_1_locked, semester_2_locked')
      .in('student_id', [...new Set(progressStudentIds)])
      .eq('entry_type', 'current');
    (years || []).forEach((year) => {
      yearsByStudent.set(`${year.student_id}:${year.school_year}`, {
        semester_1_locked: Boolean(year.semester_1_locked),
        semester_2_locked: Boolean(year.semester_2_locked),
      });
    });
  }

  const userIds = [...new Set(tasks.map((t) => t.user_id))];
  const profilesByUser = await loadProfiles(admin, userIds);
  const sentKeys = await loadSentKeys(admin, tasks.map((t) => t.id));
  let sent = 0;

  const onboardingTasks: Array<{ task: DocRow; kind: OnboardingBundleKind }> = [];
  for (const task of tasks as DocRow[]) {
    const kind = classifyTask(task);
    if (isOnboardingKind(kind)) {
      onboardingTasks.push({ task, kind });
    }
  }
  sent += await processOnboardingBundles(admin, onboardingTasks, profilesByUser, sentKeys);

  for (const task of tasks as DocRow[]) {
    const kind = classifyTask(task);
    if (!kind || isOnboardingKind(kind)) continue;

    const profile = profilesByUser.get(task.user_id);
    const familyEmail = profile?.email || '';
    const familyName = formatFamilyName(profile, familyEmail);

    if (kind === 'progress') {
      const studentId = String(task.url || '').startsWith(PROGRESS_URL_PREFIX)
        ? String(task.url).slice(PROGRESS_URL_PREFIX.length).trim()
        : null;
      const year = studentId && task.school_year
        ? yearsByStudent.get(`${studentId}:${task.school_year}`)
        : null;
      const student = studentId ? studentsById.get(studentId) : null;
      const progress = getProgressContext(task, year, student, today);
      if (!progress) continue;

      const familySlots = progress.kind === 'progress_s2' && progress.isSenior
        ? SENIOR_SCHEDULE_SLOTS
        : PROGRESS_STANDARD_SLOTS;
      const anchors = { due: progress.dueDate };

      for (const slot of familySlots) {
        if (!slotTriggersToday(slot, anchors)) continue;
        const key = reminderKey('family', slot, progress.semester);
        if (sentKeys.has(`${task.id}:${key}`)) continue;
        if (!familyEmail) continue;

        const mail = buildFamilyReminderEmail({
          kind: progress.kind,
          slot,
          studentLabel: progress.studentLabel,
          dueDate: progress.dueDate,
        });
        await sendEmail(familyEmail, mail.subject, mail.text, mail.html);
        await markSent(admin, task.id, key, familyEmail);
        sentKeys.add(`${task.id}:${key}`);
        sent += 1;
      }

      if (progress.kind === 'progress_s2' && progress.isSenior) {
        for (const slot of SENIOR_ADMIN_SLOTS) {
          if (!slotTriggersToday(slot, anchors)) continue;
          const key = reminderKey('admin', slot, progress.semester);
          if (sentKeys.has(`${task.id}:${key}`)) continue;

          const mail = buildAdminReminderEmail({
            kind: 'progress_s2',
            slot,
            familyName,
            familyEmail: familyEmail || 'unknown',
            studentLabel: progress.studentLabel,
            taskTitle: task.title,
            dueDate: progress.dueDate,
          });
          await sendEmail(ADMIN_NOTIFY_EMAIL, mail.subject, mail.text, mail.html);
          await markSent(admin, task.id, key, ADMIN_NOTIFY_EMAIL);
          sentKeys.add(`${task.id}:${key}`);
          sent += 1;
        }
      } else if (slotTriggersToday('admin_overdue', anchors)) {
        const key = reminderKey('admin', 'admin_overdue', progress.semester);
        if (!sentKeys.has(`${task.id}:${key}`)) {
          const mail = buildAdminReminderEmail({
            kind: progress.kind,
            slot: 'admin_overdue',
            familyName,
            familyEmail: familyEmail || 'unknown',
            studentLabel: progress.studentLabel,
            taskTitle: task.title,
            dueDate: progress.dueDate,
          });
          await sendEmail(ADMIN_NOTIFY_EMAIL, mail.subject, mail.text, mail.html);
          await markSent(admin, task.id, key, ADMIN_NOTIFY_EMAIL);
          sentKeys.add(`${task.id}:${key}`);
          sent += 1;
        }
      }
      continue;
    }

    if (kind === 'senior_graduation' || kind === 'kindergarten_graduation') {
      const prefix = kind === 'senior_graduation' ? GRAD_URL_PREFIX : KG_URL_PREFIX;
      const titlePrefix = kind === 'senior_graduation'
        ? /^Graduation Order —\s*/i
        : /^Kindergarten Graduation —\s*/i;
      const studentId = String(task.url || '').startsWith(prefix)
        ? String(task.url).slice(prefix.length).trim()
        : null;
      if (!studentId) continue;

      const incomplete = await graduationIncomplete(admin, studentId, task.school_year, kind);
      if (!incomplete) continue;

      const student = studentsById.get(studentId);
      const studentLabel = studentDisplayName(student) !== 'Student'
        ? studentDisplayName(student)
        : studentLabelFromTitle(task.title, titlePrefix);
      const dueDate = task.due_date_1;
      const anchors = { due: dueDate };

      for (const slot of SENIOR_SCHEDULE_SLOTS) {
        if (!slotTriggersToday(slot, anchors)) continue;
        const key = reminderKey('family', slot);
        if (sentKeys.has(`${task.id}:${key}`)) continue;
        if (!familyEmail) continue;

        const mail = buildFamilyReminderEmail({
          kind,
          slot,
          studentLabel,
          dueDate,
        });
        await sendEmail(familyEmail, mail.subject, mail.text, mail.html);
        await markSent(admin, task.id, key, familyEmail);
        sentKeys.add(`${task.id}:${key}`);
        sent += 1;
      }

      for (const slot of SENIOR_ADMIN_SLOTS) {
        if (!slotTriggersToday(slot, anchors)) continue;
        const key = reminderKey('admin', slot);
        if (sentKeys.has(`${task.id}:${key}`)) continue;

        const mail = buildAdminReminderEmail({
          kind,
          slot,
          familyName,
          familyEmail: familyEmail || 'unknown',
          studentLabel,
          taskTitle: task.title,
          dueDate,
        });
        await sendEmail(ADMIN_NOTIFY_EMAIL, mail.subject, mail.text, mail.html);
        await markSent(admin, task.id, key, ADMIN_NOTIFY_EMAIL);
        sentKeys.add(`${task.id}:${key}`);
        sent += 1;
      }
    }
  }

  return { sent, skipped_live_gate: !REMINDERS_LIVE };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendPreviewEmails() {
  const sampleDue = '2026-05-15';
  let sent = 0;

  for (const variant of PREVIEW_VARIANTS) {
    const mail = variant.audience === 'family' && variant.kind === 'onboarding_checklist'
      ? buildOnboardingBundleEmail({
        slot: variant.slot,
        items: SAMPLE_ONBOARDING_BUNDLE_ITEMS,
        preview: true,
      })
      : variant.audience === 'family'
        ? buildFamilyReminderEmail({
          kind: variant.kind,
          slot: variant.slot,
          studentLabel: variant.studentLabel,
          dueDate: sampleDue,
          preview: true,
        })
        : variant.kind === 'coc' && variant.slot === 'admin_overdue'
          ? buildOnboardingBundleAdminEmail({
            familyName: 'Johnson family',
            familyEmail: 'sample.family@example.com',
            items: SAMPLE_ONBOARDING_BUNDLE_ITEMS,
            preview: true,
          })
          : buildAdminReminderEmail({
            kind: variant.kind,
            slot: variant.slot,
            familyName: 'Johnson family',
            familyEmail: 'sample.family@example.com',
            studentLabel: variant.studentLabel || 'Sample Student',
            taskTitle: `Sample task — ${variant.label}`,
            dueDate: sampleDue,
            preview: true,
          });

    const subject = mail.subject.startsWith('[PREVIEW]')
      ? mail.subject
      : `[PREVIEW] ${mail.subject}`;
    await sendEmail(PREVIEW_EMAIL, subject, mail.text, mail.html);
    sent += 1;
    await sleep(150);
  }

  return sent;
}

async function sendOnboardingBundlePreview() {
  const mail = buildOnboardingBundleEmail({
    slot: 'due',
    items: SAMPLE_ONBOARDING_BUNDLE_ITEMS,
    preview: true,
  });
  await sendEmail(PREVIEW_EMAIL, mail.subject, mail.text, mail.html);
  return 1;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({})) as { action?: string };
    const action = String(body.action || 'scan').trim();
    const secret = req.headers.get('x-webhook-secret') || '';

    if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'preview_onboarding_bundle') {
      const sent = await sendOnboardingBundlePreview();
      return new Response(JSON.stringify({
        ok: true,
        action: 'preview_onboarding_bundle',
        sent,
        preview_recipient: PREVIEW_EMAIL,
        live: REMINDERS_LIVE,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'preview') {
      const sent = await sendPreviewEmails();
      return new Response(JSON.stringify({
        ok: true,
        action: 'preview',
        sent,
        preview_recipient: PREVIEW_EMAIL,
        live: REMINDERS_LIVE,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!REMINDERS_LIVE) {
      return new Response(JSON.stringify({
        ok: true,
        action: 'scan',
        sent: 0,
        live: false,
        message: 'TASK_REMINDERS_LIVE is false; no family/admin reminders sent. Use action preview to review templates.',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const today = todayIso();
    const result = await processTaskReminders(admin, today);

    return new Response(JSON.stringify({
      ok: true,
      action: 'scan',
      today,
      live: true,
      ...result,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('notify-task-reminders error:', error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});