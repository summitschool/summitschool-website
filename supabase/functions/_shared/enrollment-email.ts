import { escapeHtml, FAMILY_HUB_URL, LOGO_URL, SITE_URL } from './family-hub-email.ts';

export const ENROLLMENT_COMPLETE_URL = `${SITE_URL}/enrollment-complete.html`;
export const ENROLLMENT_ADMIN_SIGNED_URL = `${SITE_URL}/enrollment-admin-signed.html`;
export const ENROLLMENT_RETURNING_URL = `${SITE_URL}/enrollment-returning.html`;
export const ENROLLMENT_CONTACT_URL = `${SITE_URL}/index.html#contact`;
export const FAMILY_HUB_SIGNUP_URL = `${FAMILY_HUB_URL}#signup`;
export const FAMILY_HUB_SIGNIN_URL = FAMILY_HUB_URL;

type EnrollmentEmailOptions = {
  title: string;
  preheader?: string;
  greeting?: string;
  paragraphs: string[];
  extraHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote: string;
};

function buildEnrollmentEmailHtml(options: EnrollmentEmailOptions) {
  const greetingBlock = options.greeting
    ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#475569;">${options.greeting}</p>`
    : '';

  const paragraphBlocks = options.paragraphs.map((paragraph) => (
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#64748b;">${paragraph}</p>`
  )).join('');

  const ctaBlock = options.ctaLabel && options.ctaUrl
    ? `<a href="${escapeHtml(options.ctaUrl)}"
         style="display:inline-block;padding:14px 28px;background:#1B365D;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;border-radius:16px;">
        ${escapeHtml(options.ctaLabel)}
      </a>`
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F8F6F1;font-family:Inter,Arial,sans-serif;color:#334155;">
  ${options.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(options.preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#F8F6F1;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 12px;text-align:center;">
              <img src="${LOGO_URL}" alt="Summit Church School" width="112" height="112"
                   style="display:block;margin:0 auto 16px;width:112px;height:auto;max-height:112px;border-radius:16px;">
              <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#8B9A7B;font-weight:600;">Summit Church School</p>
              <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:#1B365D;">${escapeHtml(options.title)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 24px;text-align:center;">
              ${greetingBlock}
              ${paragraphBlocks}
              ${options.extraHtml || ''}
              ${ctaBlock ? `<div style="margin-top:8px;">${ctaBlock}</div>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;text-align:center;">
                ${options.footerNote}
              </p>
              <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#cbd5e1;text-align:center;">
                Summit Church School • <a href="${SITE_URL}" style="color:#8B9A7B;text-decoration:none;">${SITE_URL}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export function buildEnrollmentReceivedFamilyEmail(firstName: string) {
  const greeting = firstName === 'there'
    ? 'Hello,'
    : `Hello ${escapeHtml(firstName)},`;

  const hubRequiredHtml = `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;background:#F5F0E6;border:2px solid rgba(201,162,39,0.45);border-radius:16px;text-align:left;">
                <tr>
                  <td style="padding:18px 20px;font-size:14px;line-height:1.65;color:#1B365D;">
                    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a7b1a;text-align:center;">Required</p>
                    <p style="margin:0;font-size:15px;font-weight:700;text-align:center;">Create your Summit Family Hub account if you have not already</p>
                    <p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#475569;text-align:center;">
                      Every enrolled family uses the Hub for grade submissions, assigned tasks, school resources, and accountability. You cannot complete the school year setup without it.
                    </p>
                  </td>
                </tr>
              </table>`;

  const hubOverviewHtml = `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;text-align:left;">
                <tr>
                  <td style="padding:18px 20px;font-size:14px;line-height:1.65;color:#64748b;">
                    <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#1B365D;text-align:center;">Once inside the Family Hub</p>
                    <p style="margin:0 0 10px;"><strong style="color:#1B365D;">Family Hub Setup Checklist</strong> (in <strong>My Tasks</strong>)<br>Start here for the new school year: add each student in Academic Records, read how progress reports work, sign the Code of Conduct, and upload your government-issued ID.</p>
                    <p style="margin:0 0 10px;"><strong style="color:#1B365D;">My Tasks</strong><br>Complete every assigned task by its due date, including forms and seasonal school requirements.</p>
                    <p style="margin:0 0 10px;"><strong style="color:#1B365D;">Academic Records</strong><br>Enter semester grades and attendance, then submit progress reports when each semester is ready.</p>
                    <p style="margin:0;"><strong style="color:#1B365D;">My Documents</strong><br>Your signed enrollment letter and other official school documents will appear here once your Hub access is approved.</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#64748b;text-align:center;">
                Already created your account?
                <a href="${escapeHtml(FAMILY_HUB_SIGNIN_URL)}" style="color:#7C8F7E;font-weight:600;text-decoration:underline;">Sign in to the Family Hub</a>
                and watch for your access approval email if you have not received one yet.
              </p>`;

  const html = buildEnrollmentEmailHtml({
    title: 'Enrollment approved',
    preheader: 'Your enrollment is approved. Create or sign in to the Summit Family Hub to get started.',
    greeting,
    paragraphs: [
      'Great news — your <strong>Summit Church School</strong> enrollment is now officially <strong>approved</strong> for the upcoming school year.',
      'Thank you for completing your application and tuition payment. If you have not already created your <strong>Summit Family Hub</strong> account, please do that now — it is required for every enrolled family.',
      'Your signed enrollment documents will be available in <strong>My Documents</strong> inside the Hub once your account is created and staff have approved your access. You do not need to save a copy from this email.',
    ],
    extraHtml: `${hubRequiredHtml}${hubOverviewHtml}`,
    ctaLabel: 'Create Family Hub Account',
    ctaUrl: FAMILY_HUB_SIGNUP_URL,
    footerNote: 'Questions? Reply to this email, text 256-328-3966, or contact us through our website.',
  });

  const text = [
    firstName === 'there' ? 'Hello,' : `Hello ${firstName},`,
    '',
    'Great news — your Summit Church School enrollment is now officially approved for the upcoming school year.',
    '',
    'Thank you for completing your application and tuition payment.',
    '',
    'REQUIRED: Create your Summit Family Hub account if you have not already.',
    'Every enrolled family uses the Hub for grade submissions, assigned tasks, school resources, and accountability.',
    '',
    `Create your account: ${FAMILY_HUB_SIGNUP_URL}`,
    `Already signed up? Sign in: ${FAMILY_HUB_SIGNIN_URL}`,
    '',
    'Once inside the Family Hub:',
    '- Family Hub Setup Checklist (My Tasks): add students, read the progress report guide, sign Code of Conduct, upload ID',
    '- My Tasks: complete all assigned tasks by their due dates',
    '- Academic Records: enter grades and submit progress reports each semester',
    '- My Documents: your signed enrollment letter and official school documents',
    '',
    'Summit Church School',
  ].filter(Boolean).join('\n');

  return {
    subject: 'Summit enrollment approved — create your Family Hub account',
    html,
    text,
  };
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function formatAdminFamilyDetails(options: {
  submitterName: string;
  submitterEmail: string;
  templateName: string;
}) {
  const email = options.submitterEmail || 'No email provided';
  const rawName = options.submitterName.trim();
  const normalizedName = rawName.toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  const hasDistinctName = Boolean(
    rawName
    && normalizedName !== normalizedEmail
    && !looksLikeEmail(rawName),
  );

  const htmlLines = hasDistinctName
    ? `<strong>Family:</strong> ${escapeHtml(rawName)}<br><strong>Email:</strong> ${escapeHtml(email)}`
    : `<strong>Email:</strong> ${escapeHtml(email)}`;

  const textLines = hasDistinctName
    ? [`Family: ${rawName}`, `Email: ${email}`]
    : [`Email: ${email}`];

  const subjectLabel = hasDistinctName ? rawName : email;

  return {
    email,
    htmlLines: `${htmlLines}<br><strong>Form:</strong> ${escapeHtml(options.templateName)}`,
    textLines: [...textLines, `Form: ${options.templateName}`],
    subjectLabel,
  };
}

export function buildEnrollmentAdminSignatureRequestEmail(options: {
  submitterName: string;
  submitterEmail: string;
  templateName: string;
  submissionId: number;
  signingUrl: string;
  fallbackReviewUrl: string;
}) {
  const signUrl = options.signingUrl || options.fallbackReviewUrl;
  const details = formatAdminFamilyDetails(options);

  const html = buildEnrollmentEmailHtml({
    title: 'Enrollment application ready to sign',
    preheader: 'A family submitted an enrollment application that needs the school signature.',
    greeting: 'Hello,',
    paragraphs: [
      'A family has completed their portion of the <strong>Summit Church School</strong> enrollment application.',
      details.htmlLines,
      'Use the button below to open the document and add the school signature. No DocuSeal login is required — this link goes directly to the signing form.',
      'After you sign, the family will receive their approval email with Family Hub signup instructions and new-year checklist overview.',
    ],
    ctaLabel: 'Review and Sign',
    ctaUrl: signUrl,
    footerNote: 'This alert is sent only for the public enrollment application form.',
  });

  const text = [
    'Enrollment application ready for school signature',
    '',
    ...details.textLines,
    `Submission ID: ${options.submissionId}`,
    `Review and sign: ${signUrl}`,
  ].join('\n');

  return {
    subject: `Enrollment application ready to sign — ${details.subjectLabel}`,
    html,
    text,
  };
}