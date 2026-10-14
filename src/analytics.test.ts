import { afterEach, describe, expect, it, vi } from 'vitest';
import { tabPageViewParams, trackTabView } from './analytics.ts';

describe('analytics', () => {
  afterEach(() => {
    delete (globalThis as { gtag?: unknown }).gtag;
    vi.unstubAllGlobals();
  });

  it('builds a page_view with the full URL and tab title', () => {
    expect(tabPageViewParams('https://x.test/app/#lineup', 'Playoff Planner', 'Lineup')).toEqual({
      page_location: 'https://x.test/app/#lineup',
      page_title: 'Playoff Planner – Lineup',
    });
  });

  it('sends exactly one page_view event per call when the tag is present', () => {
    const gtag = vi.fn();
    (globalThis as { gtag?: unknown }).gtag = gtag;
    vi.stubGlobal('location', { href: 'https://x.test/app/#roster' });
    trackTabView('Roster');
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith('event', 'page_view', { page_location: 'https://x.test/app/#roster', page_title: 'Playoff Planner – Roster' });
  });

  it('does nothing when the tag is blocked or missing', () => {
    expect(() => trackTabView('Roster')).not.toThrow();
  });
});
