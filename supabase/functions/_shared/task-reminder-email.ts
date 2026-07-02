import { buildFamilyHubEmailHtml, escapeHtml, FAMILY_HUB_URL } from './family-hub-email.ts';

export const ADMIN_EMAIL = 'info@summitchurchschool.org';
export const PREVIEW_EMAIL = 'sjesimon@gmail.com';

export type TaskKind =
  | 'onboarding_checklist'
  | 'coc'
  | 'id_upload'
  | 'progress_s1'
  | 'progress_s2'
  | 'senior_graduation'
  | 'kindergarten_graduation';

export type ReminderSlot =
  | 'day3'
  | 'day7'
  | 'days15'
  | 'days10'
  | 'days5'
  | 'days3'
  | 'due'
  | 'overdue1'
  | 'overdue2'
  | 'admin_overdue'
  | 'admin_days3'
  | 'admin_due';

export type ReminderEmail = {
  subject: string;
  text: string;
  html: string;
  reminderKey: string;
  audience: 'family' | 'admin';
};

export function formatDueLabel(isoDate: string | null) {
  if (!isoDate) return 'the due date shown in My Tasks';
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function taskLabel(kind: TaskKind, studentLabel?: string) {
  switch (kind) {
    case 'onboarding_checklist':
      return 'Family Hub setup checklist';
    case 'coc':
      return 'Code of Conduct signature';
    case 'id_upload':
      return 'government-issued ID upload';
    case 'progress_s1':
      return `${studentLabel || 'your student'}'s first-semester progress report`;
    case 'progress_s2':
      return `${studentLabel || 'your student'}'s second-semester progress report`;
    case 'senior_graduation':
      return `${studentLabel || 'your senior'}'s graduation order`;
    case 'kindergarten_graduation':
      return `${studentLabel || 'your kindergartener'}'s kindergarten graduation order`;
  }
}

function familyTitle(kind: TaskKind, slot: ReminderSlot) {
  if (slot === 'day3' || slot === 'day7') return 'Friendly reminder — task still open';
  if (slot === 'days15' || slot === 'days10' || slot === 'days5' || slot === 'days3') {
    return 'Progress report reminder';
  }
  if (slot === 'due') {
    if (kind === 'onboarding_checklist' || kind === 'coc' || kind === 'id_upload') {
      return 'Task due today';
    }
    if (kind === 'senior_graduation' || kind === 'kindergarten_graduation') {
      return 'Graduation order due today';
    }
    return 'Progress report due today';
  }
  if (slot === 'overdue1' || slot === 'overdue2') return 'Past-due task reminder';
  return 'Task reminder';
}

function familyPreheader(kind: TaskKind, slot: ReminderSlot, label: string, dueText: string) {
  if (slot === 'day3') return `${label} has been open for 3 days.`;
  if (slot === 'day7') return `${label} has been open for a week.`;
  if (slot === 'days15') return `${label} is due in 15 days (${dueText}).`;
  if (slot === 'days10') return `${label} is due in 10 days (${dueText}).`;
  if (slot === 'days5') return `${label} is due in 5 days (${dueText}).`;
  if (slot === 'days3') return `${label} is due in 3 days (${dueText}).`;
  if (slot === 'due') return `${label} is due today (${dueText}).`;
  if (slot === 'overdue1') return `${label} was due yesterday.`;
  if (slot === 'overdue2') return `${label} is now 2 days past due.`;
  return label;
}

function familyParagraphs(kind: TaskKind, slot: ReminderSlot, label: string, dueText: string): string[] {
  const hubLine = 'Open <strong>Family Hub → My Tasks</strong> to finish this item.';

  if (kind === 'onboarding_checklist') {
    if (slot === 'day3') {
      return [
        `Your <strong>${escapeHtml(label)}</strong> has been waiting for three days.`,
        'Work through each checklist step, then mark the checklist complete when everything is done.',
        hubLine,
      ];
    }
    if (slot === 'day7') {
      return [
        `Your <strong>${escapeHtml(label)}</strong> has been open for a week.`,
        'New families need this checklist finished so students can move forward in Academic Records and other Hub tasks.',
        hubLine,
      ];
    }
    if (slot === 'due') {
      return [
        `Your <strong>${escapeHtml(label)}</strong> is <strong>due today</strong> (${escapeHtml(dueText)}).`,
        'Please complete every checklist step and mark the checklist done today.',
        hubLine,
      ];
    }
    return [
      `Your <strong>${escapeHtml(label)}</strong> is <strong>2 days past due</strong> (was due ${escapeHtml(dueText)}).`,
      'Please finish the checklist as soon as you can so required Hub tasks stay on track.',
      hubLine,
    ];
  }

  if (kind === 'coc' || kind === 'id_upload') {
    const action = kind === 'coc'
      ? 'Read and sign the Code of Conduct form from the task card.'
      : 'Upload a clear photo of your current government-issued ID from the task card.';
    if (slot === 'day3') {
      return [
        `Your required task — <strong>${escapeHtml(label)}</strong> — has been waiting for three days.`,
        action,
        hubLine,
      ];
    }
    if (slot === 'day7') {
      return [
        `Your required task — <strong>${escapeHtml(label)}</strong> — has been open for a week.`,
        action,
        hubLine,
      ];
    }
    if (slot === 'due') {
      return [
        `<strong>${escapeHtml(label)}</strong> is <strong>due today</strong> (${escapeHtml(dueText)}).`,
        action,
        hubLine,
      ];
    }
    return [
      `<strong>${escapeHtml(label)}</strong> is <strong>2 days past due</strong> (was due ${escapeHtml(dueText)}).`,
      action,
      hubLine,
    ];
  }

  if (kind === 'progress_s1' || kind === 'progress_s2') {
    const semester = kind === 'progress_s1' ? 'first semester' : 'second semester';
    const action = `Open <strong>Academic Records</strong> from the task card, enter ${semester} grades and attendance, and submit.`;
    if (slot === 'days15') {
      return [
        `<strong>${escapeHtml(label)}</strong> is due in <strong>15 days</strong> (${escapeHtml(dueText)}).`,
        action,
        hubLine,
      ];
    }
    if (slot === 'days10') {
      return [
        `<strong>${escapeHtml(label)}</strong> is due in <strong>10 days</strong> (${escapeHtml(dueText)}).`,
        action,
        hubLine,
      ];
    }
    if (slot === 'days5') {
      return [
        `<strong>${escapeHtml(label)}</strong> is due in <strong>5 days</strong> (${escapeHtml(dueText)}).`,
        action,
        hubLine,
      ];
    }
    if (slot === 'days3') {
      return [
        `<strong>${escapeHtml(label)}</strong> is due in <strong>3 days</strong> (${escapeHtml(dueText)}).`,
        action,
        hubLine,
      ];
    }
    if (slot === 'due') {
      return [
        `<strong>${escapeHtml(label)}</strong> is <strong>due today</strong> (${escapeHtml(dueText)}).`,
        action,
        hubLine,
      ];
    }
    const overdueDays = slot === 'overdue1' ? '1 day' : '2 days';
    return [
      `<strong>${escapeHtml(label)}</strong> is <strong>${overdueDays} past due</strong> (was due ${escapeHtml(dueText)}).`,
      action,
      hubLine,
    ];
  }

  const gradAction = kind === 'senior_graduation'
    ? 'Open the <strong>Graduation Hub</strong> from the task card to complete cap &amp; gown sizing, fees, and payment.'
    : 'Open the <strong>Kindergarten Graduation Hub</strong> from the task card to complete your order and payment.';

  if (slot === 'days10') {
    return [
      `<strong>${escapeHtml(label)}</strong> is due in <strong>10 days</strong> (${escapeHtml(dueText)}).`,
      gradAction,
      hubLine,
    ];
  }
  if (slot === 'days5') {
    return [
      `<strong>${escapeHtml(label)}</strong> is due in <strong>5 days</strong> (${escapeHtml(dueText)}).`,
      gradAction,
      hubLine,
    ];
  }
  if (slot === 'days3') {
    return [
      `<strong>${escapeHtml(label)}</strong> is due in <strong>3 days</strong> (${escapeHtml(dueText)}).`,
      gradAction,
      hubLine,
    ];
  }
  if (slot === 'due') {
    return [
      `<strong>${escapeHtml(label)}</strong> is <strong>due today</strong> (${escapeHtml(dueText)}).`,
      gradAction,
      hubLine,
    ];
  }
  return [
    `<strong>${escapeHtml(label)}</strong> is <strong>1 day past due</strong> (was due ${escapeHtml(dueText)}).`,
    gradAction,
    hubLine,
  ];
}

function adminTitle(kind: TaskKind, slot: ReminderSlot) {
  if (slot === 'admin_overdue') return 'Overdue family task alert';
  if (slot === 'admin_days3') {
    if (kind === 'progress_s2') return 'Senior progress report due in 3 days';
    return 'Graduation order due in 3 days';
  }
  if (kind === 'progress_s2') return 'Senior progress report due today';
  return 'Graduation order due today';
}

function adminParagraphs(
  kind: TaskKind,
  slot: ReminderSlot,
  familyEmail: string,
  studentLabel: string,
  taskTitle: string,
  dueText: string,
): string[] {
  const familyLine = `Family login: <strong>${escapeHtml(familyEmail || 'unknown')}</strong>`;
  const studentLine = studentLabel
    ? `Student: <strong>${escapeHtml(studentLabel)}</strong>`
    : '';
  const taskLine = `Task: <strong>${escapeHtml(taskTitle)}</strong>`;

  if (slot === 'admin_overdue') {
    const overdueKind = kind === 'onboarding_checklist' || kind === 'coc' || kind === 'id_upload'
      ? 'new-family onboarding'
      : kind === 'progress_s1'
        ? 'first-semester progress report'
        : 'second-semester progress report';
    return [
      `A <strong>${overdueKind}</strong> task is <strong>past due</strong> (due ${escapeHtml(dueText)}).`,
      familyLine,
      taskLine,
      studentLine,
      'Follow up with the family in Family Hub admin tools.',
    ].filter(Boolean);
  }

  if (slot === 'admin_days3') {
    const label = kind === 'progress_s2'
      ? `${studentLabel}'s second-semester progress report`
      : kind === 'senior_graduation'
        ? `${studentLabel}'s senior graduation order`
        : `${studentLabel}'s kindergarten graduation order`;
    return [
      `<strong>${escapeHtml(label)}</strong> is <strong>due in 3 days</strong> (${escapeHtml(dueText)}) and is still incomplete.`,
      familyLine,
      taskLine,
      'Consider a personal follow-up before the deadline.',
    ];
  }

  const label = kind === 'progress_s2'
    ? `${studentLabel}'s second-semester progress report`
    : kind === 'senior_graduation'
      ? `${studentLabel}'s senior graduation order`
      : `${studentLabel}'s kindergarten graduation order`;
  return [
    `<strong>${escapeHtml(label)}</strong> is <strong>due today</strong> (${escapeHtml(dueText)}) and is still incomplete.`,
    familyLine,
    taskLine,
    'Please follow up with the family today.',
  ];
}

export function buildFamilyReminderEmail(options: {
  kind: TaskKind;
  slot: ReminderSlot;
  studentLabel?: string;
  dueDate: string | null;
  preview?: boolean;
}): ReminderEmail {
  const label = taskLabel(options.kind, options.studentLabel);
  const dueText = formatDueLabel(options.dueDate);
  const title = familyTitle(options.kind, options.slot);
  const preheader = familyPreheader(options.kind, options.slot, label, dueText);
  const paragraphs = familyParagraphs(options.kind, options.slot, label, dueText);
  const subject = options.preview
    ? `[PREVIEW] ${title} — ${label}`
    : `${title} — ${label}`;

  const text = [
    'Hello,',
    '',
    paragraphs.map((p) => p.replace(/<[^>]+>/g, '')).join(' '),
    '',
    `Open Family Hub: ${FAMILY_HUB_URL}`,
    '',
    'Summit Church School',
  ].join('\n');

  const html = buildFamilyHubEmailHtml({
    title,
    preheader,
    paragraphs,
    ctaLabel: 'Open Family Hub',
    ctaUrl: FAMILY_HUB_URL,
    footerNote: 'You received this because an open Family Hub task needs your attention.',
  });

  return {
    subject,
    text,
    html,
    reminderKey: `family:${options.slot}`,
    audience: 'family',
  };
}

export function buildAdminReminderEmail(options: {
  kind: TaskKind;
  slot: ReminderSlot;
  familyEmail: string;
  studentLabel: string;
  taskTitle: string;
  dueDate: string | null;
  preview?: boolean;
}): ReminderEmail {
  const dueText = formatDueLabel(options.dueDate);
  const title = adminTitle(options.kind, options.slot);
  const paragraphs = adminParagraphs(
    options.kind,
    options.slot,
    options.familyEmail,
    options.studentLabel,
    options.taskTitle,
    dueText,
  );
  const subject = options.preview
    ? `[PREVIEW] [Admin] ${title}`
    : `[Admin] ${title}`;

  const text = [
    'Summit admin alert,',
    '',
    paragraphs.map((p) => p.replace(/<[^>]+>/g, '')).join(' '),
    '',
    'Summit Church School Family Hub',
  ].join('\n');

  const html = buildFamilyHubEmailHtml({
    title,
    preheader: subject,
    greeting: 'Summit admin alert,',
    paragraphs,
    ctaLabel: 'Open Family Hub',
    ctaUrl: FAMILY_HUB_URL,
    footerNote: 'Internal reminder for Summit Church School staff.',
  });

  return {
    subject,
    text,
    html,
    reminderKey: `admin:${options.slot}`,
    audience: 'admin',
  };
}

export type PreviewVariant = {
  label: string;
  kind: TaskKind;
  slot: ReminderSlot;
  audience: 'family' | 'admin';
  studentLabel?: string;
};

export const PREVIEW_VARIANTS: PreviewVariant[] = [
  { label: 'Checklist — 3 days open', kind: 'onboarding_checklist', slot: 'day3', audience: 'family' },
  { label: 'Checklist — 7 days open', kind: 'onboarding_checklist', slot: 'day7', audience: 'family' },
  { label: 'Checklist — due today', kind: 'onboarding_checklist', slot: 'due', audience: 'family' },
  { label: 'Checklist — 2 days past due', kind: 'onboarding_checklist', slot: 'overdue2', audience: 'family' },
  { label: 'Code of Conduct — 3 days open', kind: 'coc', slot: 'day3', audience: 'family' },
  { label: 'Code of Conduct — 7 days open', kind: 'coc', slot: 'day7', audience: 'family' },
  { label: 'Code of Conduct — due today', kind: 'coc', slot: 'due', audience: 'family' },
  { label: 'Code of Conduct — 2 days past due', kind: 'coc', slot: 'overdue2', audience: 'family' },
  { label: 'ID upload — 3 days open', kind: 'id_upload', slot: 'day3', audience: 'family' },
  { label: 'ID upload — 7 days open', kind: 'id_upload', slot: 'day7', audience: 'family' },
  { label: 'ID upload — due today', kind: 'id_upload', slot: 'due', audience: 'family' },
  { label: 'ID upload — 2 days past due', kind: 'id_upload', slot: 'overdue2', audience: 'family' },
  { label: 'Admin — new-family task overdue', kind: 'coc', slot: 'admin_overdue', audience: 'admin' },
  { label: 'S1 progress — 15 days until due', kind: 'progress_s1', slot: 'days15', audience: 'family', studentLabel: 'Alex Johnson' },
  { label: 'S1 progress — 10 days until due', kind: 'progress_s1', slot: 'days10', audience: 'family', studentLabel: 'Alex Johnson' },
  { label: 'S1 progress — 3 days until due', kind: 'progress_s1', slot: 'days3', audience: 'family', studentLabel: 'Alex Johnson' },
  { label: 'S1 progress — due today', kind: 'progress_s1', slot: 'due', audience: 'family', studentLabel: 'Alex Johnson' },
  { label: 'S1 progress — 2 days past due', kind: 'progress_s1', slot: 'overdue2', audience: 'family', studentLabel: 'Alex Johnson' },
  { label: 'Admin — S1 progress overdue', kind: 'progress_s1', slot: 'admin_overdue', audience: 'admin', studentLabel: 'Alex Johnson' },
  { label: 'S2 progress (K–11) — 15 days until due', kind: 'progress_s2', slot: 'days15', audience: 'family', studentLabel: 'Jamie Smith' },
  { label: 'S2 progress (K–11) — 10 days until due', kind: 'progress_s2', slot: 'days10', audience: 'family', studentLabel: 'Jamie Smith' },
  { label: 'S2 progress (K–11) — 3 days until due', kind: 'progress_s2', slot: 'days3', audience: 'family', studentLabel: 'Jamie Smith' },
  { label: 'S2 progress (K–11) — due today', kind: 'progress_s2', slot: 'due', audience: 'family', studentLabel: 'Jamie Smith' },
  { label: 'S2 progress (K–11) — 2 days past due', kind: 'progress_s2', slot: 'overdue2', audience: 'family', studentLabel: 'Jamie Smith' },
  { label: 'Admin — S2 progress (K–11) overdue', kind: 'progress_s2', slot: 'admin_overdue', audience: 'admin', studentLabel: 'Jamie Smith' },
  { label: 'S2 progress (Grade 12) — 10 days until due', kind: 'progress_s2', slot: 'days10', audience: 'family', studentLabel: 'Taylor Lee' },
  { label: 'S2 progress (Grade 12) — 5 days until due', kind: 'progress_s2', slot: 'days5', audience: 'family', studentLabel: 'Taylor Lee' },
  { label: 'S2 progress (Grade 12) — 3 days until due', kind: 'progress_s2', slot: 'days3', audience: 'family', studentLabel: 'Taylor Lee' },
  { label: 'S2 progress (Grade 12) — due today', kind: 'progress_s2', slot: 'due', audience: 'family', studentLabel: 'Taylor Lee' },
  { label: 'S2 progress (Grade 12) — 1 day past due', kind: 'progress_s2', slot: 'overdue1', audience: 'family', studentLabel: 'Taylor Lee' },
  { label: 'Admin — senior S2 due in 3 days', kind: 'progress_s2', slot: 'admin_days3', audience: 'admin', studentLabel: 'Taylor Lee' },
  { label: 'Admin — senior S2 due today', kind: 'progress_s2', slot: 'admin_due', audience: 'admin', studentLabel: 'Taylor Lee' },
  { label: 'Senior graduation — 10 days until due', kind: 'senior_graduation', slot: 'days10', audience: 'family', studentLabel: 'Taylor Lee' },
  { label: 'Senior graduation — 5 days until due', kind: 'senior_graduation', slot: 'days5', audience: 'family', studentLabel: 'Taylor Lee' },
  { label: 'Senior graduation — 3 days until due', kind: 'senior_graduation', slot: 'days3', audience: 'family', studentLabel: 'Taylor Lee' },
  { label: 'Senior graduation — due today', kind: 'senior_graduation', slot: 'due', audience: 'family', studentLabel: 'Taylor Lee' },
  { label: 'Senior graduation — 1 day past due', kind: 'senior_graduation', slot: 'overdue1', audience: 'family', studentLabel: 'Taylor Lee' },
  { label: 'Admin — senior graduation due in 3 days', kind: 'senior_graduation', slot: 'admin_days3', audience: 'admin', studentLabel: 'Taylor Lee' },
  { label: 'Admin — senior graduation due today', kind: 'senior_graduation', slot: 'admin_due', audience: 'admin', studentLabel: 'Taylor Lee' },
  { label: 'Kindergarten graduation — 10 days until due', kind: 'kindergarten_graduation', slot: 'days10', audience: 'family', studentLabel: 'Sam Patel' },
  { label: 'Kindergarten graduation — 5 days until due', kind: 'kindergarten_graduation', slot: 'days5', audience: 'family', studentLabel: 'Sam Patel' },
  { label: 'Kindergarten graduation — 3 days until due', kind: 'kindergarten_graduation', slot: 'days3', audience: 'family', studentLabel: 'Sam Patel' },
  { label: 'Kindergarten graduation — due today', kind: 'kindergarten_graduation', slot: 'due', audience: 'family', studentLabel: 'Sam Patel' },
  { label: 'Kindergarten graduation — 1 day past due', kind: 'kindergarten_graduation', slot: 'overdue1', audience: 'family', studentLabel: 'Sam Patel' },
  { label: 'Admin — kindergarten graduation due in 3 days', kind: 'kindergarten_graduation', slot: 'admin_days3', audience: 'admin', studentLabel: 'Sam Patel' },
  { label: 'Admin — kindergarten graduation due today', kind: 'kindergarten_graduation', slot: 'admin_due', audience: 'admin', studentLabel: 'Sam Patel' },
];