/**
 * Contact form delivery via FormSubmit (formsubmit.co), the same service
 * Letter Ladder uses. The endpoint uses FormSubmit's random-string alias, so
 * the owner's email address never appears in this site's code or traffic.
 *
 * Set the alias here (or via VITE_CONTACT_FORM_ID at build time). While it is
 * empty the Contact link is hidden.
 */
export const CONTACT_FORM_ID: string = import.meta.env.VITE_CONTACT_FORM_ID ?? '';

export const contactEnabled = () => CONTACT_FORM_ID.trim().length > 0;

export interface ContactMessage {
  name: string;
  email: string;
  message: string;
}

export const MESSAGE_MAX = 5000;

/** Request body for FormSubmit's AJAX endpoint. `_honey` is FormSubmit's spam trap and must stay empty. */
export function contactPayload(m: ContactMessage, honey = ''): Record<string, string> {
  return {
    name: m.name.trim(),
    email: m.email.trim(),
    message: m.message.trim().slice(0, MESSAGE_MAX),
    _subject: 'Playoff Planner — Contact form message',
    _template: 'box',
    _captcha: 'false',
    _honey: honey,
  };
}

/** Send a message. Resolves on success; throws with a user-facing message otherwise. */
export async function sendContact(m: ContactMessage, honey = '', fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!contactEnabled()) throw new Error('The contact form isn’t set up yet.');
  if (!m.message.trim()) throw new Error('Please enter a message.');
  let res: Response;
  try {
    res = await fetchImpl(`https://formsubmit.co/ajax/${encodeURIComponent(CONTACT_FORM_ID.trim())}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(contactPayload(m, honey)),
    });
  } catch {
    throw new Error('Couldn’t reach the server. Check your connection and try again.');
  }
  let ok = res.ok;
  try {
    const body = (await res.json()) as { success?: string | boolean };
    if (body && (body.success === false || body.success === 'false')) ok = false;
  } catch {
    // A non-JSON reply on a 2xx status is still treated as delivered.
  }
  if (!ok) throw new Error('Your message couldn’t be sent. Please try again later.');
}
