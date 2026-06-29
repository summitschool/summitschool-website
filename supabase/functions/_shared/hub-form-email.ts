import { SITE_URL } from './family-hub-email.ts';

export const HUB_FORM_COMPLETE_URL = `${SITE_URL}/hub-form-complete.html`;

export function buildHubFormCompleteUrl(templateSlug: string) {
  return `${HUB_FORM_COMPLETE_URL}?template=${encodeURIComponent(templateSlug)}`;
}