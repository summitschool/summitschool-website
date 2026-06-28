export const SITE_URL = 'https://summitchurchschool.org';
export const LOGO_URL = `${SITE_URL}/images/logo.png`;
export const FAMILY_HUB_URL = `${SITE_URL}/members.html`;

export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type FamilyHubEmailOptions = {
  title: string;
  preheader?: string;
  greeting?: string;
  paragraphs: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote: string;
};

export function buildFamilyHubEmailHtml(options: FamilyHubEmailOptions) {
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
              ${ctaBlock ? `<div style="margin-top:8px;">${ctaBlock}</div>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;text-align:center;">
                ${options.footerNote}
              </p>
              <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#cbd5e1;text-align:center;">
                Summit Family Hub • <a href="${SITE_URL}" style="color:#8B9A7B;text-decoration:none;">${SITE_URL}</a>
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