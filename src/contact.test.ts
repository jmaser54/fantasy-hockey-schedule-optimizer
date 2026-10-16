import { describe, expect, it } from 'vitest';
import { CONTACT_ACTION, CONTACT_FIELDS, contactReturnUrl } from './contact.ts';

describe('contact form', () => {
  it('uses Letter Ladder’s FormSubmit recipient and settings', () => {
    // Letter Ladder contact.html: action="https://formsubmit.co/jmaser4@gmail.com" method="POST",
    // _template=box, _captcha=false, _subject and _next set per site.
    expect(CONTACT_ACTION).toBe('https://formsubmit.co/jmaser4@gmail.com');
    expect(CONTACT_FIELDS).toEqual({ _subject: 'Playoff Planner — Contact form message', _template: 'box', _captcha: 'false' });
  });

  it('returns visitors to the same page and tab, flagged as sent', () => {
    const loc = { origin: 'https://jmaser54.github.io', pathname: '/fantasy-hockey-schedule-optimizer/', hash: '#lineup' };
    expect(contactReturnUrl(loc)).toBe('https://jmaser54.github.io/fantasy-hockey-schedule-optimizer/?contact=sent#lineup');
    expect(contactReturnUrl({ ...loc, hash: '' })).toBe('https://jmaser54.github.io/fantasy-hockey-schedule-optimizer/?contact=sent');
  });
});
