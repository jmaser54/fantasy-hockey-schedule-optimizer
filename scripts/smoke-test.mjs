/**
 * Smoke test for the deployed site (run by deploy-pages.yml after each deploy).
 *
 *   node scripts/smoke-test.mjs https://<user>.github.io/<repo>/
 *
 * Checks that the live site serves the data snapshot from this commit (retrying
 * while the Pages CDN catches up), then drives the app in headless Chromium:
 * rankings render, a player can be added, the lineup optimizer produces totals,
 * and nothing logs an error. Exits non-zero on any failure.
 */
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = (process.argv[2] ?? '').replace(/\/?$/, '/');
if (!/^https?:\/\//.test(base)) {
  console.error('Usage: node scripts/smoke-test.mjs <site url>');
  process.exit(2);
}
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. The live data must be the snapshot committed in this checkout.
const local = JSON.parse(await readFile('public/data/schedule.json', 'utf8'));
let live;
for (let attempt = 1; attempt <= 20; attempt++) {
  try {
    const res = await fetch(`${base}data/schedule.json?check=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      live = await res.json();
      if (live.fetchedAt === local.fetchedAt) break;
      console.log(`attempt ${attempt}: live data ${live.fetchedAt}, expected ${local.fetchedAt}; waiting for CDN…`);
    } else {
      console.log(`attempt ${attempt}: HTTP ${res.status}`);
    }
  } catch (err) {
    console.log(`attempt ${attempt}: ${err.message}`);
  }
  await sleep(30_000);
}
if (!live || live.fetchedAt !== local.fetchedAt) fail('live site does not serve the committed data snapshot');
console.log(`live data OK: ${live.games.length} games, ${live.teams.length} teams, fetched ${live.fetchedAt}`);

// 2. Drive the app.
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// Google Analytics: record each GA4 hit and answer it locally with an empty success, so
// test runs never reach the real property (an aborted hit would be retried by gtag and
// show up twice). Reported below for visibility; never fails the smoke test.
const gaHits = [];
await page.route(/google-analytics\.com\/(g|[a-z]\/)?collect/, (route) => {
  const req = route.request();
  const body = req.postData() ?? '';
  // A request can batch several events: one per line in the body, or a single one in the URL.
  const lines = body ? body.split('\n').filter(Boolean) : [''];
  for (const line of lines) {
    const params = new URLSearchParams(`${new URL(req.url()).search.slice(1)}&${line}`);
    // Per-event values in the body override the batch's shared values in the URL.
    const last = (k) => params.getAll(k).at(-1);
    gaHits.push({ en: last('en'), dl: last('dl'), dt: last('dt') });
  }
  return route.fulfill({ status: 204, body: '' });
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// Failed loads from Google's analytics hosts are expected on networks that block the tag;
// they are not app errors.
const isAnalytics = (url = '') => /googletagmanager\.com|google-analytics\.com/.test(url);
page.on('console', (m) => m.type() === 'error' && !isAnalytics(m.location().url) && errors.push(m.text()));
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('table tbody tr', { timeout: 30_000 });
  const rows = await page.locator('table tbody tr').count();
  if (rows !== live.teams.length) fail(`rankings show ${rows} teams, expected ${live.teams.length}`);
  const chip = await page.locator('.data-status').innerText();
  if (!/NHL data/.test(chip)) fail(`unexpected data status: ${chip}`);
  console.log(`rankings OK: ${rows} teams; status "${chip.trim()}"`);

  await page.getByRole('tab', { name: /^Roster/ }).click();
  if (!(await page.getByLabel('Paste player names').isVisible())) fail('paste mode is not the default on the roster page');
  await page.getByRole('tab', { name: 'Search Players' }).click();
  await page.getByLabel('Search players').fill('Connor McDavid');
  await page.locator('.suggest li').first().click();
  await page.getByRole('tab', { name: 'Lineup' }).click();
  const heading = await page.locator('.panel-head h2').first().innerText();
  if (!/of \d+ scheduled games fit your lineup/.test(heading)) fail(`lineup heading unexpected: ${heading}`);
  console.log(`lineup OK: "${heading}"`);

  // gtag can keep the network busy, so don't wait for network idle; wait for the
  // reloaded Lineup page (#lineup) to render its heading instead.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.panel-head h2', { hasText: /of \d+ scheduled games fit your lineup/ }).first().waitFor({ timeout: 30_000 });
  await page.getByRole('tab', { name: /^Roster/ }).click();
  const counts = await page.locator('.counts').innerText();
  if (!/Roster\s+1\//.test(counts)) fail(`roster not restored after reload: ${counts}`);
  console.log('persistence OK');

  // Report GA4 page views for the initial load plus tab switches.
  // gtag keeps a connection busy, so wait for 'load' rather than network idle.
  await page.goto(`${base}#rankings`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('table tbody tr');
  await page.waitForTimeout(3000);
  for (const tab of [/^Roster/, 'Lineup', 'Trade Lab']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(3000);
  const views = gaHits.filter((h) => h.en === 'page_view');
  console.log(`analytics: ${gaHits.length} GA4 hits captured (not sent to Google); page_view ${views.length}`);
  for (const v of views) console.log(`  page_view ${v.dl} | ${v.dt}`);
} finally {
  await browser.close();
}
if (errors.length) fail(`browser errors:\n${errors.join('\n')}`);
console.log(`PASS ${base}`);
