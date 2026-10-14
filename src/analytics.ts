/**
 * GA4 page views for in-app tab changes. The Google tag in index.html sends the initial
 * page view on load. Tabs switch via the URL hash, which GA4 neither tracks nor keeps in
 * page_location, so each later tab view is sent here once, with the tab name in the title.
 */
type Gtag = (...args: unknown[]) => void;

export function tabPageViewParams(href: string, siteTitle: string, tabLabel: string) {
  return { page_location: href, page_title: `${siteTitle} – ${tabLabel}` };
}

export function trackTabView(tabLabel: string): void {
  const gtag = (globalThis as { gtag?: Gtag }).gtag;
  if (typeof gtag !== 'function') return; // tag blocked or not loaded
  gtag('event', 'page_view', tabPageViewParams(globalThis.location.href, 'Playoff Planner', tabLabel));
}
