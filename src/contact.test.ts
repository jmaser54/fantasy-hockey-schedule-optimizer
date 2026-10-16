import { afterEach, describe, expect, it, vi } from 'vitest';

const load = async (id: string) => {
  vi.resetModules();
  vi.stubEnv('VITE_CONTACT_FORM_ID', id);
  return import('./contact.ts');
};
const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

afterEach(() => vi.unstubAllEnvs());

describe('contact form', () => {
  it('is disabled (link hidden) until a FormSubmit alias is configured', async () => {
    expect((await load('')).contactEnabled()).toBe(false);
    const m = await load('');
    await expect(m.sendContact({ name: '', email: '', message: 'hi' })).rejects.toThrow(/isn’t set up/);
  });

  it('posts to the FormSubmit alias endpoint, never an email address', async () => {
    const m = await load('a1b2c3d4e5');
    expect(m.contactEnabled()).toBe(true);
    const fetchImpl = vi.fn(() => reply(200, { success: 'true' }));
    await m.sendContact({ name: ' Jo ', email: ' jo@example.com ', message: ' Great app ' }, '', fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://formsubmit.co/ajax/a1b2c3d4e5');
    expect(url).not.toContain('@');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Jo',
      email: 'jo@example.com',
      message: 'Great app',
      _subject: 'Playoff Planner — Contact form message',
      _template: 'box',
      _captcha: 'false',
      _honey: '',
    });
  });

  it('requires a message, passes the spam trap through, and reports failures', async () => {
    const m = await load('a1b2c3d4e5');
    await expect(m.sendContact({ name: 'x', email: '', message: '   ' })).rejects.toThrow(/enter a message/);
    expect(m.contactPayload({ name: '', email: '', message: 'x' }, 'bot')._honey).toBe('bot');
    await expect(m.sendContact({ name: '', email: '', message: 'x' }, '', (() => reply(500, {})) as unknown as typeof fetch)).rejects.toThrow(/couldn’t be sent/);
    await expect(m.sendContact({ name: '', email: '', message: 'x' }, '', (() => reply(200, { success: 'false' })) as unknown as typeof fetch)).rejects.toThrow(/couldn’t be sent/);
    await expect(m.sendContact({ name: '', email: '', message: 'x' }, '', (() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch)).rejects.toThrow(/reach the server/);
  });
});
