import { escapeHtml, LOGO_URL, SITE_URL } from './family-hub-email.ts';

export const ENROLLMENT_COMPLETE_URL = `${SITE_URL}/enrollment-complete.html`;
export const ENROLLMENT_ADMIN_SIGNED_URL = `${SITE_URL}/enrollment-admin-signed.html`;
export const ENROLLMENT_TUITION_URL = `${SITE_URL}/index.html#enrollment`;
export const ENROLLMENT_CONTACT_URL = `${SITE_URL}/index.html#contact`;

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

  const nextStepsHtml = `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;text-align:left;">
                <tr>
                  <td style="padding:18px 20px;font-size:14px;line-height:1.65;color:#64748b;">
                    <p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#1B365D;text-align:center;">What happens next</p>
                    <p style="margin:0 0 10px;"><strong style="color:#1B365D;">1. Pay tuition</strong><br>Submit annual tuition on our website using PayPal or Cash App.</p>
                    <p style="margin:0 0 10px;"><strong style="color:#1B365D;">2. Create your Family Hub account</strong><br>Register for the Summit Family Hub and staff will approve your access.</p>
                    <p style="margin:0;"><strong style="color:#1B365D;">3. Enrollment documents</strong><br>Your signed enrollment letter and other school documents will be available in the Hub once access is approved.</p>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 16px;max-width:420px;width:100%;">
                <tr>
                  <td style="padding:14px 16px;background:#F5F0E6;border:1px solid rgba(201,162,39,0.35);border-radius:14px;text-align:center;">
                    <p style="margin:0;font-size:13px;line-height:1.55;color:#1B365D;font-weight:600;">
                      Include the enrolling parent&rsquo;s full name and email address in the tuition payment note so we can match your payment to your application.
                    </p>
                  </td>
                </tr>
              </table>`;

  const html = buildEnrollmentEmailHtml({
    title: 'Enrollment approved',
    preheader: 'Your Summit Church School enrollment application has been reviewed and approved.',
    greeting,
    paragraphs: [
      'Great news — your <strong>Summit Church School</strong> enrollment application has been reviewed and approved.',
      'Your signed enrollment documents will be available in the <strong>Summit Family Hub</strong> once you create your account and access is approved. You do not need to save a copy from this email.',
      'Your next step is to <strong>pay annual tuition</strong> on our website, then create your Family Hub account.',
    ],
    extraHtml: nextStepsHtml,
    ctaLabel: 'Pay Tuition & View Next Steps',
    ctaUrl: ENROLLMENT_TUITION_URL,
    footerNote: 'Questions? Contact us through our website and we will be happy to help.',
  });

  const text = [
    firstName === 'there' ? 'Hello,' : `Hello ${firstName},`,
    '',
    'Great news — your Summit Church School enrollment application has been reviewed and approved.',
    'Your signed enrollment documents will be available in the Summit Family Hub once you create your account and access is approved.',
    '',
    'Next steps:',
    '1. Pay tuition on our website (PayPal or Cash App).',
    '2. Create your Family Hub account.',
    '3. Access your enrollment documents once access is approved.',
    '',
    `Pay tuition and view next steps: ${ENROLLMENT_TUITION_URL}`,
    '',
    'Summit Church School',
  ].filter(Boolean).join('\n');

  return {
    subject: 'Summit enrollment approved — next step: pay tuition',
    html,
    text,
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
  const name = options.submitterName || 'Unknown';
  const email = options.submitterEmail || 'No email provided';
  const signUrl = options.signingUrl || options.fallbackReviewUrl;

  const html = buildEnrollmentEmailHtml({
    title: 'Enrollment application ready to sign',
    preheader: 'A family submitted an enrollment application that needs the school signature.',
    greeting: 'Hello,',
    paragraphs: [
      'A family has completed their portion of the <strong>Summit Church School</strong> enrollment application.',
      `<strong>Family:</strong> ${escapeHtml(name)}<br><strong>Email:</strong> ${escapeHtml(email)}<br><strong>Form:</strong> ${escapeHtml(options.templateName)}`,
      'Use the button below to open the document and add the school signature. No DocuSeal login is required — this link goes directly to the signing form.',
      'After you sign, the family will receive their approval email with tuition and Family Hub next steps.',
    ],
    ctaLabel: 'Review and Sign',
    ctaUrl: signUrl,
    footerNote: 'This alert is sent only for the public enrollment application form.',
  });

  const text = [
    'Enrollment application ready for school signature',
    '',
    `Family: ${name}`,
    `Email: ${email}`,
    `Form: ${options.templateName}`,
    `Submission ID: ${options.submissionId}`,
    `Review and sign: ${signUrl}`,
  ].join('\n');

  return {
    subject: `Enrollment application ready to sign — ${name}`,
    html,
    text,
  };
}