/**
 * Contact form delivery: a standard FormSubmit (formsubmit.co) form post, the
 * same recipient and settings as Letter Ladder's contact.html. After sending,
 * FormSubmit redirects the visitor back here (`_next`) with `?contact=sent`.
 */
export const CONTACT_ACTION = 'https://formsubmit.co/jmaser4@gmail.com';

export const CONTACT_FIELDS = {
  _subject: 'Playoff Planner — Contact form message',
  _template: 'box',
  _captcha: 'false',
} as const;

export const MESSAGE_MAX = 5000;
const SENT_PARAM = 'contact';

/** Absolute URL FormSubmit returns the visitor to: this page and tab, flagged as sent. */
export function contactReturnUrl(loc: Pick<Location, 'origin' | 'pathname' | 'hash'> = location): string {
  return `${loc.origin}${loc.pathname}?${SENT_PARAM}=sent${loc.hash}`;
}

/** True when arriving back from FormSubmit; removes the flag from the address bar. */
export function takeContactReturn(): boolean {
  const params = new URLSearchParams(location.search);
  if (params.get(SENT_PARAM) !== 'sent') return false;
  params.delete(SENT_PARAM);
  const q = params.toString();
  history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
  return true;
}
