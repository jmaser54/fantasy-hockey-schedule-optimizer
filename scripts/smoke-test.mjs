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
// A context (not browser.newPage) so a second tab can share this tab's saved data.
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

// Storage isolation: the live and testing sites share one domain, so each uses its own key. Seed
// the other site's key with a different roster; this site must never read, sync from or change it.
const siteKey = /\/fantasy-hockey-schedule-optimizer-testing\/$/.test(new URL(base).pathname) ? 'playoff-optimizer-testing:v1' : 'playoff-optimizer:v1';
const otherKey = siteKey === 'playoff-optimizer:v1' ? 'playoff-optimizer-testing:v1' : 'playoff-optimizer:v1';
const otherSiteData = JSON.stringify({ version: 1, roster: [{ playerId: 'nhl-8477492', onIr: false }, { playerId: 'nhl-8478483', onIr: false }] });
await context.addInitScript(([k, v]) => localStorage.getItem(k) === null && localStorage.setItem(k, v), [otherKey, otherSiteData]);

// Google Analytics: record each GA4 hit and answer it locally with an empty success, so
// test runs never reach the real property (an aborted hit would be retried by gtag and
// show up twice). Reported below for visibility; never fails the smoke test.
const gaHits = [];
await context.route(/google-analytics\.com\/(g|[a-z]\/)?collect/, (route) => {
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
const dialogs = [];
// Failed loads from Google's analytics hosts are expected on networks that block the tag;
// they are not app errors.
const isAnalytics = (url = '') => /googletagmanager\.com|google-analytics\.com/.test(url);
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !isAnalytics(m.location().url) && errors.push(m.text()));
  p.on('dialog', (d) => {
    dialogs.push(d.message());
    d.accept();
  }); // Reset <period> to Optimal asks for confirmation
};
watch(page);
/** Poll until check() is true, or fail with msg. */
const until = async (check, msg, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await check()) return;
  fail(msg);
};
try {
  // Not network idle (gtag can keep a request open): wait for the loaded data instead.
  // Team counts are in the first table on Team Schedules (the Schedule Grid follows).
  await page.goto(`${base}#rankings`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.table-wrap table tbody tr', { timeout: 30_000 });
  await page.locator('.data-status', { hasText: 'NHL data' }).waitFor({ timeout: 30_000 });
  const rows = await page.locator('.table-wrap table tbody tr').count();
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

  // 3. Reset <period> to Optimal: the screen and saved data update at once, in this tab and in
  // another open tab (which must not keep showing, or later re-save, the old lineup).
  await page.getByRole('tab', { name: 'Lineup' }).click();
  const starters = (p) => p.locator('.day-editor .seat').evaluateAll((rs) => rs.filter((r) => r.querySelector('.pos-btn').textContent !== 'BN' && r.querySelector('.who b')).map((r) => r.querySelector('.who b').textContent));
  const savedDays = (p) => p.evaluate((k) => Object.keys(JSON.parse(localStorage.getItem(k)).manual).length, siteKey);
  const benchMcDavid = async (p) => {
    const ed = p.locator('.day-editor');
    await ed.locator('.seat', { hasText: 'Connor McDavid' }).locator('.pos-btn').click();
    await ed.locator('.seat', { hasText: 'Empty' }).filter({ has: p.locator('.pos-btn.target', { hasText: /^BN$/ }) }).locator('.pos-btn').click();
  };
  const resetPeriod = (p) => p.getByRole('button', { name: /^Reset (?!Day ).+ to Optimal$/ }).click();
  const days = await page.locator('.lgrid .day-btn').count();
  let day = -1;
  for (let i = 0; i < days && day < 0; i++) {
    await page.locator('.lgrid .day-btn').nth(i).click();
    await page.locator('.day-editor').waitFor();
    if ((await starters(page)).includes('Connor McDavid')) day = i;
    else await page.locator('.lgrid .day-btn').nth(i).click();
  }
  if (day < 0) {
    console.log('reset check skipped: Connor McDavid has no game in the selected week');
  } else {
    await benchMcDavid(page);
    if ((await starters(page)).includes('Connor McDavid') || (await savedDays(page)) !== 1) fail('manual move to the bench was not applied');
    await resetPeriod(page);
    await until(async () => (await starters(page)).includes('Connor McDavid') && (await savedDays(page)) === 0, 'Reset to Optimal did not update the lineup on screen and in saved data');
    if (dialogs.at(-1) !== 'Revert lineup changes?') fail(`reset confirmation wording: ${JSON.stringify(dialogs.at(-1))}`);
    console.log('reset OK: lineup and saved data updated at once; confirmation "Revert lineup changes?"');

    const other = await context.newPage();
    watch(other);
    await other.goto(`${base}#lineup`, { waitUntil: 'domcontentloaded' });
    await other.locator('.lgrid .day-btn').nth(day).click();
    await other.locator('.day-editor').waitFor({ timeout: 30_000 });
    await benchMcDavid(page);
    await until(async () => !(await starters(other)).includes('Connor McDavid'), 'a lineup change did not reach the other open tab');
    await resetPeriod(other);
    await until(async () => (await starters(page)).includes('Connor McDavid') && (await savedDays(page)) === 0, 'a reset in another tab did not update this tab');
    // A write to the other site's storage (as its open tab would make) must not reach this page.
    await other.evaluate(([k, v]) => localStorage.setItem(k, v), [otherKey, JSON.stringify({ version: 1, roster: [] })]);
    await sleep(500);
    if (!/^Roster\s*1$/.test((await page.locator('.tab', { hasText: 'Roster' }).innerText()).trim())) fail('a change to the other site\'s storage reached this page');
    await other.evaluate(([k, v]) => localStorage.setItem(k, v), [otherKey, otherSiteData]);
    await other.close();
    console.log('two tabs OK: changes and resets show in every open tab at once');
  }
  const otherNow = await page.evaluate((k) => localStorage.getItem(k), otherKey);
  if (otherNow !== otherSiteData) fail(`this site changed the other site's saved data (${otherKey})`);
  console.log(`storage isolation OK: ${siteKey} used; ${otherKey} untouched`);

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
