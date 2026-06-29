import { escapeHtml, LOGO_URL, SITE_URL } from './family-hub-email.ts';

export const DMV_PERMIT_FORM_COMPLETE_URL = `${SITE_URL}/dmv-permit-form-complete.html`;

export function buildDmvPermitFormCompleteUrl(templateSlug: string) {
  return `${DMV_PERMIT_FORM_COMPLETE_URL}?template=${encodeURIComponent(templateSlug)}`;
}

type DmvFormEmailOptions = {
  title: string;
  preheader?: string;
  greeting?: string;
  paragraphs: string[];
  footerNote: string;
};

function buildDmvFormEmailHtml(options: DmvFormEmailOptions) {
  const greetingBlock = options.greeting
    ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#475569;">${options.greeting}</p>`
    : '';

  const paragraphBlocks = options.paragraphs.map((paragraph) => (
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#64748b;">${paragraph}</p>`
  )).join('');

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

export function buildDmvPermitFormCompletedEmail(options: {
  recipientName: string;
  templateName: string;
}) {
  const firstName = options.recipientName.trim().split(/\s+/)[0] || 'there';
  const greeting = firstName === 'there'
    ? 'Hello,'
    : `Hello ${escapeHtml(firstName)},`;

  const html = buildDmvFormEmailHtml({
    title: 'Your DMV form is ready',
    preheader: 'Your signed driver education form is attached — bring it to the DMV.',
    greeting,
    paragraphs: [
      'Thank you for completing the <strong>Summit Church School</strong> driver education form.',
      `Your signed copy of <strong>${escapeHtml(options.templateName)}</strong> is attached to this email.`,
      'Please <strong>print or save the attached PDF</strong> and bring it with you to the DMV when your student applies for a learner&rsquo;s permit or driver&rsquo;s license.',
      'If you have questions about the form or what to bring to the DMV, contact us through our website.',
    ],
    footerNote: 'Keep this signed form for your records and for your DMV visit.',
  });

  const text = [
    firstName === 'there' ? 'Hello,' : `Hello ${firstName},`,
    '',
    'Thank you for completing the Summit Church School driver education form.',
    `Your signed copy of ${options.templateName} is attached to this email.`,
    '',
    'Please print or save the attached PDF and bring it with you to the DMV when your student applies for a learner\'s permit or driver\'s license.',
    '',
    'Summit Church School',
    SITE_URL,
  ].join('\n');

  return {
    subject: 'Your signed DMV driver education form — Summit Church School',
    html,
    text,
  };
}