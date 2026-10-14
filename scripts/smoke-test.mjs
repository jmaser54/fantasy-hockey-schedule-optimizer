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
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('table tbody tr', { timeout: 30_000 });
  const rows = await page.locator('table tbody tr').count();
  if (rows !== live.teams.length) fail(`rankings show ${rows} teams, expected ${live.teams.length}`);
  const chip = await page.locator('.data-status').innerText();
  if (!/NHL data/.test(chip)) fail(`unexpected data status: ${chip}`);
  console.log(`rankings OK: ${rows} teams; status "${chip.trim()}"`);

  await page.getByRole('tab', { name: /Roster/ }).click();
  if (!(await page.getByLabel('Paste player names').isVisible())) fail('paste mode is not the default on the roster page');
  await page.getByRole('tab', { name: 'Search players' }).click();
  await page.getByLabel('Search players').fill('Connor McDavid');
  await page.locator('.suggest li').first().click();
  await page.getByRole('tab', { name: 'Lineup' }).click();
  const heading = await page.locator('.panel-head h2').first().innerText();
  if (!/usable of \d+ games/.test(heading)) fail(`lineup heading unexpected: ${heading}`);
  console.log(`lineup OK: "${heading}"`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /Roster/ }).click();
  const counts = await page.locator('.counts').innerText();
  if (!/Roster\s+1\//.test(counts)) fail(`roster not restored after reload: ${counts}`);
  console.log('persistence OK');
} finally {
  await browser.close();
}
if (errors.length) fail(`browser errors:\n${errors.join('\n')}`);
console.log(`PASS ${base}`);
