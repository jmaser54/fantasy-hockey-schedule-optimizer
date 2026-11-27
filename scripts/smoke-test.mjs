/**
 * Smoke test for the deployed site (run by deploy-pages.yml after each deploy).
 *
 *   node scripts/smoke-test.mjs https://<user>.github.io/<repo>/
 *
 * Checks that the live site serves the data snapshot from this commit (retrying
 * while the Pages CDN catches up), then drives the app in headless Chromium:
 * rankings render, a player can be added, the lineup optimizer produces totals,
 * the Player Evaluator (current and completed seasons) works, and nothing logs an error.
 * Exits non-zero on any failure.
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

// 1. The live data must be the snapshot committed in this checkout, or a newer one: a push that
// touches the data pipeline also starts a refresh, whose deploy can land on top of this one.
const local = JSON.parse(await readFile('public/data/schedule.json', 'utf8'));
const atLeastLocal = (d) => Date.parse(d.fetchedAt) >= Date.parse(local.fetchedAt);
let live;
for (let attempt = 1; attempt <= 20; attempt++) {
  try {
    const res = await fetch(`${base}data/schedule.json?check=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      live = await res.json();
      if (atLeastLocal(live)) break;
      console.log(`attempt ${attempt}: live data ${live.fetchedAt}, expected ${local.fetchedAt}; waiting for CDN…`);
    } else {
      console.log(`attempt ${attempt}: HTTP ${res.status}`);
    }
  } catch (err) {
    console.log(`attempt ${attempt}: ${err.message}`);
  }
  await sleep(30_000);
}
if (!live || !atLeastLocal(live)) fail('live site does not serve the committed data snapshot (or a newer one)');
console.log(`live data OK: ${live.games.length} games, ${live.teams.length} teams, fetched ${live.fetchedAt}${live.fetchedAt !== local.fetchedAt ? ` (newer than this checkout's ${local.fetchedAt})` : ''}`);

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
let dismissNextDialog = false;
// Failed loads from Google's analytics hosts are expected on networks that block the tag;
// they are not app errors.
const isAnalytics = (url = '') => /googletagmanager\.com|google-analytics\.com/.test(url);
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !isAnalytics(m.location().url) && errors.push(m.text()));
  p.on('dialog', (d) => {
    dialogs.push(d.message());
    if (dismissNextDialog) {
      dismissNextDialog = false;
      d.dismiss();
    } else d.accept();
  }); // Reset <period> to Optimal and leaving unsaved League Settings ask for confirmation
};
watch(page);
/** Poll until check() is true, or fail with msg. */
const until = async (check, msg, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await check()) return;
  fail(msg);
};
// ---------------------------------------------------------------------------
// Historical seasons (Player Evaluator). Completed seasons are static snapshots, so a refresh deploying
// on top of this one can't change them. Expectations come from the fetched files (who leads in points,
// a player's GP), never from fixed rankings, values or timestamps.

const evalKey = /\/fantasy-hockey-schedule-optimizer-testing\/$/.test(new URL(base).pathname) ? 'playoff-evaluator-testing:v1' : 'playoff-evaluator:v1';
/** "20242025" → "2024–25", as the app labels seasons. */
const seasonLabel = (s) => `${s.slice(0, 4)}–${s.slice(6)}`;

/** The completed seasons listed in HISTORICAL_SEASONS (src/data/format.ts), so this test follows the app. */
async function historicalSeasons() {
  const src = await readFile('src/data/format.ts', 'utf8');
  const list = [...src.matchAll(/season: '(\d{8})', teamGames: (\d+)/g)].map((m) => ({ season: m[1], teamGames: Number(m[2]) }));
  if (list.length === 0) fail('no HISTORICAL_SEASONS found in src/data/format.ts');
  return list;
}

/** Fetch and sanity-check one season's snapshot (retried: one dropped connection shouldn't fail the run). */
async function fetchSeason({ season, teamGames }) {
  const url = new URL(`data/skater-stats-${season}.json`, base);
  let last = 'no response';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      last = `HTTP ${res.status}`;
      if (res.ok) {
        const data = await res.json();
        if (data.season !== season || data.gameType !== 2 || !Array.isArray(data.skaters)) fail(`${url} is not the ${season} regular-season snapshot`);
        if (data.skaters.length < 500) fail(`${url} has only ${data.skaters.length} skaters`);
        const maxGp = Math.max(...data.skaters.map((x) => x.gamesPlayed));
        if (maxGp < teamGames) fail(`${url} looks incomplete (most GP ${maxGp}, expected ≥ ${teamGames})`);
        return data;
      }
    } catch (err) {
      last = err.cause?.code ?? err.message;
    }
    if (attempt < 3) await sleep(5_000);
  }
  fail(`${url} not served (${last})`);
}

/** Names of the points leaders (ties included) among skaters with at least `minGp` games: Player Rankings' default order. */
function leaders(skaters, value, minGp = 10) {
  const pool = skaters.filter((x) => x.gamesPlayed >= minGp);
  const best = Math.max(...pool.map(value));
  return new Set(pool.filter((x) => Math.abs(value(x) - best) < 1e-9).map((x) => x.name));
}

async function checkHistoricalSeasons(rosterSaved) {
  const seasons = await historicalSeasons();
  const files = new Map();
  for (const h of seasons) files.set(h.season, await fetchSeason(h));
  console.log(`historical data OK: ${seasons.map((h) => `${h.season} (${files.get(h.season).skaters.length} skaters)`).join(', ')}`);

  const select = page.locator('#season-select');
  const benchSelect = page.locator('#bench-select');
  const options = async (l) => (await l.locator('option').allTextContents()).map((t) => t.trim());
  const savedPrefs = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), evalKey);
  const firstRowName = () => page.locator('.rank-table tbody tr').first().locator('.ev-name span').first().innerText();
  const showSeason = async (season) => {
    await select.selectOption(season);
    await page.locator('.eval-head', { hasText: `NHL ${seasonLabel(season)} regular season (final)` }).waitFor({ timeout: 30_000 });
    await page.locator('.eval-table tbody tr').first().waitFor({ timeout: 30_000 });
  };

  // Player Rankings (where the evaluator check left off): a new visitor starts on the current season.
  for (const tab of ['Player Rankings', 'My Players']) {
    await page.getByRole('tab', { name: tab }).click();
    await select.waitFor({ timeout: 30_000 });
    const labels = await options(select);
    for (const h of seasons) if (!labels.includes(seasonLabel(h.season))) fail(`${tab}: season selector lacks ${seasonLabel(h.season)} (${labels.join(', ')})`);
  }
  const current = await select.inputValue();
  if (files.has(current)) fail(`a new visitor starts on ${current}, not the current season`);
  const currentBench = await benchSelect.inputValue();
  const currentOptions = await options(benchSelect);

  // Each completed season on Player Rankings: its own data, Full season (totals) and Per game.
  await page.getByRole('tab', { name: 'Player Rankings' }).click();
  for (const h of seasons) {
    const file = files.get(h.season);
    await showSeason(h.season);
    const opts = await options(benchSelect);
    if (opts.join('|') !== 'Full season|Per game') fail(`${h.season}: benchmark options ${opts.join(', ')}`);
    if ((await benchSelect.inputValue()) !== 'full-season') await benchSelect.selectOption('full-season');
    if (!/Full-season totals/.test(await page.locator('.bench-main').innerText())) fail(`${h.season}: Full season not shown as season totals`);
    const top = await firstRowName();
    if (!leaders(file.skaters, (x) => x.points).has(top)) fail(`${h.season} Full season: ${top} is not the season's points leader in the snapshot`);
    if (await page.locator('.rank-table tbody tr').first().locator('.ev-cell').count()) fail(`${h.season} Full season: cells show normalized values`);
    await benchSelect.selectOption('per-game');
    await page.locator('.bench-main', { hasText: /per game played/i }).waitFor({ timeout: 10_000 });
    const perGameTop = await firstRowName();
    if (!leaders(file.skaters, (x) => x.points / x.gamesPlayed).has(perGameTop)) fail(`${h.season} Per game: ${perGameTop} is not the season's points-per-game leader in the snapshot`);
    const cell = await page.locator('.rank-table tbody tr').first().locator('.ev-cell b').first().innerText();
    if (!/^\d+\.\d{3}$/.test(cell)) fail(`${h.season} Per game: normalized cell "${cell}"`);
    console.log(`historical ${seasonLabel(h.season)} OK: Full season leader ${top}; Per game leader ${perGameTop}`);
  }

  // The last season and Per game are saved and survive a reload.
  const last = seasons[seasons.length - 1].season;
  let prefs = await savedPrefs();
  if (prefs.season !== last || prefs.historicalBasis !== 'per-game') fail(`season preferences not saved: ${JSON.stringify(prefs)}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.eval-head', { hasText: `NHL ${seasonLabel(last)} regular season (final)` }).waitFor({ timeout: 30_000 });
  if ((await select.inputValue()) !== last || (await benchSelect.inputValue()) !== 'per-game') fail(`after reload: ${await select.inputValue()} / ${await benchSelect.inputValue()}`);

  // My Players follows the same season; the roster player's GP is that season's.
  await page.getByRole('tab', { name: 'My Players' }).click();
  await page.locator('.eval-table tbody tr', { hasText: 'Connor McDavid' }).waitFor({ timeout: 30_000 });
  if ((await select.inputValue()) !== last) fail(`My Players shows ${await select.inputValue()}, not the saved ${last}`);
  const line = files.get(last).skaters.find((x) => x.name === 'Connor McDavid');
  const gp = (await page.locator('.eval-table tbody tr', { hasText: 'Connor McDavid' }).locator('td').first().innerText()).trim();
  if (line ? gp !== String(line.gamesPlayed) : !/No NHL games/.test(await page.locator('.eval-table tbody tr', { hasText: 'Connor McDavid' }).innerText())) {
    fail(`My Players ${last}: McDavid shows "${gp}", snapshot has ${line?.gamesPlayed ?? 'no games'}`);
  }
  console.log(`historical persistence OK: ${seasonLabel(last)} and Per game kept after reload, on both pages`);

  // Back to the current season: its own benchmark options and choice, normalized values again.
  await select.selectOption(current);
  await page.locator('.bench-main', { hasText: /Normalized to\s*\d+ GP/ }).waitFor({ timeout: 30_000 });
  if ((await options(benchSelect)).join('|') !== currentOptions.join('|')) fail(`current-season benchmark options changed: ${(await options(benchSelect)).join(', ')}`);
  if ((await benchSelect.inputValue()) !== currentBench) fail(`current-season benchmark is ${await benchSelect.inputValue()}, was ${currentBench}`);
  if (await page.locator('.eval-head', { hasText: '(final)' }).count()) fail('current season still labelled as a completed season');
  prefs = await savedPrefs();
  if (prefs.season !== null) fail(`returning to the current season saved ${JSON.stringify(prefs.season)}`);
  if ((await page.evaluate((k) => localStorage.getItem(k), siteKey)) !== rosterSaved) fail('historical seasons changed the saved roster');
  console.log(`current season restored OK: ${currentOptions.join(', ')}; benchmark ${currentBench}`);
}

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
  // Grid tab (2026-11-24: the Schedule Grid has its own tab after Schedules).
  const order = (await page.locator('.planner-tabs .tab').allInnerTexts()).map((t) => t.replace(/\s*(\d+|!)$/, '').trim());
  if (order.join('|') !== 'Schedules|Grid|Lineup|Trade Lab') fail(`Games Optimizer tab order: ${order.join(', ')}`);
  // Three product areas (2026-11-26): My Team holds My Roster and League Settings.
  const areaNames = (await page.locator('.areas .area').allInnerTexts()).map((t) => t.replace(/\s*!$/, '').replace(/\s+/g, ' ').trim());
  if (areaNames.join('|') !== 'Games Optimizer|Player Normalizer|My Team') fail(`product areas: ${areaNames.join(', ')}`);
  if (await page.locator('.settings-btn').count()) fail('the top-bar League Settings button is still shown');
  await page.getByRole('tab', { name: 'Grid', exact: true }).click();
  await page.locator('.sh-scroll .sgrid tbody tr').first().waitFor({ timeout: 30_000 });
  const gridRows = await page.locator('.sh-scroll .sgrid tbody tr').count();
  if (gridRows !== live.teams.length) fail(`Grid shows ${gridRows} teams, expected ${live.teams.length}`);
  if ((await page.locator('.sh-scroll .table-wrap table, .sh-scroll table:not(.sgrid)').count()) > 0) fail('the team schedules table is still on the Grid tab');
  console.log(`grid OK: tabs ${order.join(' | ')}; Grid tab shows ${gridRows} teams on its own`);
  await page.getByRole('tab', { name: 'Schedules', exact: true }).click();
  await page.locator('.table-wrap table tbody tr').first().waitFor({ timeout: 30_000 });

  const myTeam = () => page.getByRole('button', { name: 'My Team', exact: true }).click();
  await myTeam();
  const teamTabs = (await page.locator('.team-tabs .tab').allInnerTexts()).map((t) => t.replace(/\s*(\d+|!)$/, '').trim());
  if (teamTabs.join('|') !== 'My Roster|League Settings') fail(`My Team tabs: ${teamTabs.join(', ')}`);
  if (!(await page.getByRole('tab', { name: /^My Roster/ }).getAttribute('aria-selected')) || !page.url().endsWith('#roster')) fail('My Team did not open on My Roster (#roster)');
  if (!(await page.getByLabel('Paste player names').isVisible())) fail('paste mode is not the default on the roster page');
  // Upload Image: the panel opens and the self-hosted OCR engine files are served (OCR itself isn't run here).
  await page.getByRole('tab', { name: 'Upload Image' }).click();
  if (!(await page.getByRole('button', { name: 'Choose Screenshots' }).isVisible())) fail('Upload Image panel did not open');
  // Retried: one dropped connection (ECONNRESET right after a Pages deploy, 2026-11-22) shouldn't fail the run.
  for (const f of ['worker.min.js', 'eng.traineddata.gz', 'tesseract-core-simd-lstm.wasm.js']) {
    let status = 'no response';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(new URL(`ocr/${f}`, base), { method: 'HEAD' });
        status = `HTTP ${res.status}`;
        if (res.ok) break;
      } catch (err) {
        status = err.cause?.code ?? err.message;
      }
      if (attempt < 3) await sleep(5_000);
    }
    if (!status.startsWith('HTTP 2')) fail(`OCR file ocr/${f} not served (${status})`);
  }
  console.log('upload image OK: panel opens, OCR engine files served');
  await page.getByRole('tab', { name: 'Search Players' }).click();
  await page.getByLabel('Search players').fill('Connor McDavid');
  await page.locator('.suggest li').first().click();
  // My Roster entry tools (2026-11-26): Search keeps them open; the collapse chevron folds them into one Add Players button.
  if (!(await page.getByLabel('Search players').isVisible())) fail('the entry tools closed after adding a player by search');
  const collapse = page.getByRole('button', { name: 'Collapse player tools' });
  const box = await collapse.boundingBox();
  if (!box || box.width < 40 || box.height < 40) fail(`collapse chevron tap target too small: ${JSON.stringify(box)}`);
  await collapse.click();
  const reopen = page.locator('.roster-body').getByRole('button', { name: 'Add Players', exact: true });
  if ((await page.locator('.mode-switch').count()) || !(await reopen.isVisible()) || (await reopen.getAttribute('aria-expanded')) !== 'false') fail('the collapse chevron did not fold the entry tools into Add Players');
  await reopen.click();
  if (!(await page.locator('.mode-switch').isVisible())) fail('Add Players did not reopen the entry tools');
  await collapse.click();
  console.log('roster entry OK: open after a search add, the chevron folds it, Add Players reopens it');
  // New users (2026-11-26) start with blank league settings: the League Settings tab (and My Team) keep
  // their amber mark until the settings are complete; the My Roster mark clears once the roster has a player.
  const mark = (sel) => page.locator(`${sel} .needs-mark`).count();
  const rosterTab = '.team-tabs .tab:has-text("My Roster")';
  const settingsTab = '.team-tabs .tab:has-text("League Settings")';
  const teamArea = '.areas .area:has-text("My Team")';
  if ((await mark(rosterTab)) !== 0) fail('My Roster mark still shown with a player on the roster');
  if ((await mark(settingsTab)) !== 1 || (await mark(teamArea)) !== 1) fail('League Settings / My Team mark missing while league settings are blank');
  await page.getByRole('tab', { name: /^League Settings/ }).click();
  if (!page.url().endsWith('#league-settings')) fail(`League Settings is not at #league-settings: ${page.url()}`);
  // Discard changes restores the saved (blank) values.
  await page.locator('#rs').fill('18');
  await page.getByRole('button', { name: 'Discard changes' }).click();
  if ((await page.locator('#rs').inputValue()) !== '') fail('Discard changes did not restore the saved roster size');
  // Leaving with unsaved edits asks; Cancel keeps the page and the edits.
  await page.locator('#rs').fill('18');
  dismissNextDialog = true;
  await page.getByRole('tab', { name: /^My Roster/ }).click();
  if (dialogs.at(-1) !== 'Discard your unsaved league settings changes?') fail(`unsaved-changes prompt: ${JSON.stringify(dialogs.at(-1))}`);
  if ((await page.getByRole('tab', { name: /^League Settings/ }).getAttribute('aria-selected')) !== 'true' || (await page.locator('#rs').inputValue()) !== '18') fail('cancelling the unsaved-changes prompt did not keep League Settings and its edits');
  // Save keeps the user on the page and clears the marks.
  await page.getByRole('button', { name: 'Restore Defaults' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  if ((await mark(settingsTab)) !== 0 || (await mark(teamArea)) !== 0) fail('League Settings / My Team mark still shown after completing league settings');
  // Confirming the prompt discards the edits and navigates.
  await page.locator('#ir').fill('5');
  await page.getByRole('tab', { name: /^My Roster/ }).click();
  if ((await page.getByRole('tab', { name: /^My Roster/ }).getAttribute('aria-selected')) !== 'true') fail('confirming the unsaved-changes prompt did not navigate');
  await page.getByRole('tab', { name: /^League Settings/ }).click();
  if ((await page.locator('#ir').inputValue()) !== '2') fail('confirming the unsaved-changes prompt did not discard the edits');
  console.log('my team OK: My Roster and League Settings tabs, independent marks, Save, Discard changes and the unsaved-changes prompt');
  await page.getByRole('button', { name: 'Games Optimizer', exact: true }).click();
  await page.getByRole('tab', { name: 'Lineup' }).click();
  const heading = await page.locator('.panel-head h2').first().innerText();
  if (!/of \d+ scheduled games fit your lineup/.test(heading)) fail(`lineup heading unexpected: ${heading}`);
  console.log(`lineup OK: "${heading}"`);
  // Team Schedule ↔ Set Lineup by day (2026-11-26): one shared period summary above the switcher; a date
  // header opens that day in Set Lineup; the day picked there is highlighted back in Team Schedule.
  if ((await page.locator('.lu-summary').count()) !== 1) fail('Team Schedule: the period summary is not shown exactly once');
  const dateHeads = page.locator('.sh-head .sg-date-btn');
  await dateHeads.nth(2).click();
  if ((await page.getByRole('button', { name: 'Set Lineup', exact: true }).getAttribute('aria-pressed')) !== 'true') fail('a Team Schedule date did not open Set Lineup');
  if ((await page.locator('.lu-summary').count()) !== 1) fail('Set Lineup: the period summary is not shown exactly once');
  if (!(await page.locator('.lu-day').nth(2).getAttribute('aria-pressed'))?.includes('true')) fail('Set Lineup did not select the tapped date');
  await page.locator('.lu-day').nth(4).click();
  await page.getByRole('button', { name: 'Team Schedule', exact: true }).click();
  const current = await page.locator('.sh-head .sg-date-btn[aria-current="date"]').count();
  if (current !== 1 || (await dateHeads.nth(4).getAttribute('aria-current')) !== 'date') fail('the day picked in Set Lineup is not highlighted in Team Schedule');
  console.log('lineup days OK: shared summary once; date header → Set Lineup on that day; picked day highlighted back in Team Schedule');

  // gtag can keep the network busy, so don't wait for network idle; wait for the
  // reloaded Lineup page (#lineup) to render its heading instead.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.panel-head h2', { hasText: /of \d+ scheduled games fit your lineup/ }).first().waitFor({ timeout: 30_000 });
  await myTeam();
  // The Roster box no longer shows "Roster N/limit" (2026-11-26): the restored player itself is the check.
  if (!(await page.locator('.roster-table', { hasText: 'Connor McDavid' }).count())) fail('roster not restored after reload');
  console.log('persistence OK');

  // Player Evaluator: loads the published skater stats on opening, reads the saved roster and
  // never changes it.
  const rosterSaved = await page.evaluate((k) => localStorage.getItem(k), siteKey);
  // Two product areas; each shows only its own destinations.
  await page.getByRole('button', { name: 'Player Normalizer', exact: true }).click();
  if (await page.getByRole('tab', { name: 'Lineup' }).count()) fail('Playoff Planner destinations still shown in Player Evaluator');
  await page.getByRole('tab', { name: 'My Players' }).click();
  await page.locator('.eval-table tbody tr', { hasText: 'Connor McDavid' }).waitFor({ timeout: 30_000 });
  const bench = (await page.locator('.bench-main').innerText()).replace(/\s+/g, ' ');
  if (!/Normalized to \d+ GP/.test(bench)) fail(`evaluator benchmark unexpected: ${bench}`);
  if ((await page.evaluate((k) => localStorage.getItem(k), siteKey)) !== rosterSaved) fail('Player Evaluator changed the saved roster');
  await page.getByRole('tab', { name: 'Player Rankings' }).click();
  await page.locator('.rank-table tbody tr.roster-row', { hasText: 'Connor McDavid' }).waitFor({ timeout: 30_000 });
  if ((await page.evaluate((k) => localStorage.getItem(k), siteKey)) !== rosterSaved) fail('Player Rankings changed the saved roster');
  console.log(`evaluator OK: "${bench.trim()}"; Player Rankings lists the roster player, shaded`);
  // Persistent table header (2026-11-24): scrolled down and sideways, the header stays under the tab bar
  // and lines up with its columns (scroll-driven; browsers without it show the normal header row).
  const head = await page.evaluate(async () => {
    const supported = CSS.supports('animation-timeline: scroll()');
    const sc = document.querySelector('.sh-scroll .rank-table')?.closest('.sh-scroll');
    if (!sc) return { error: 'no persistent-header table on Player Rankings' };
    window.scrollTo(0, sc.getBoundingClientRect().top + window.scrollY + 300);
    sc.scrollLeft = Math.min(120, sc.scrollWidth - sc.clientWidth);
    await new Promise((r) => setTimeout(r, 300));
    const bar = document.querySelector('.tabbar').getBoundingClientRect().bottom;
    const strip = sc.parentElement.querySelector('.sh-strip');
    const under = sc.querySelector('.sh-under');
    const scR = sc.getBoundingClientRect();
    let off = 0;
    [...strip.tHead.rows[0].cells].forEach((c, i) => {
      const u = under.rows[0].cells[i].getBoundingClientRect();
      if (u.right > scR.left + 1 && u.left < scR.right - 1) off = Math.max(off, Math.abs(c.getBoundingClientRect().x - u.x));
    });
    const top = strip.getBoundingClientRect().top;
    sc.scrollLeft = 0;
    window.scrollTo(0, 0);
    return { supported, stuck: Math.abs(top - bar) < 2, off: Math.round(off) };
  });
  if (head.error) fail(head.error);
  if (head.supported && (!head.stuck || head.off > 1)) fail(`persistent header: stuck ${head.stuck}, misaligned by ${head.off}px`);
  console.log(head.supported ? `persistent header OK: stays under the tab bar, columns aligned (${head.off}px)` : 'persistent header skipped: this browser has no scroll-driven animations (normal header row shown)');
  await checkHistoricalSeasons(rosterSaved);
  await page.getByRole('button', { name: 'Games Optimizer', exact: true }).click();
  if (await page.getByRole('tab', { name: 'My Players' }).count()) fail('Player Evaluator destinations still shown in Playoff Planner');
  for (const tab of ['Lineup', 'Trade Lab']) {
    await page.getByRole('tab', { name: tab }).click();
    if (await page.locator('#season-select').count()) fail(`season selector shown in the Games Optimizer (${tab})`);
  }
  console.log('games optimizer OK: no season selector');

  // 3. Reset <period> to Optimal: the screen and saved data update at once, in this tab and in
  // another open tab (which must not keep showing, or later re-save, the old lineup).
  await page.getByRole('tab', { name: 'Lineup' }).click();
  // The Lineup tab opens on Team Schedule (2026-11-26); the reset checks use Set Lineup.
  await page.getByRole('button', { name: 'Set Lineup', exact: true }).click();
  // Lineup (rebuild 2026-11-23): the period calendar picks the day; McDavid's row in that day's starting lineup.
  const tiles = (p) => p.locator('.lu-day');
  const savedDays = (p) => p.evaluate((k) => Object.keys(JSON.parse(localStorage.getItem(k)).manual).length, siteKey);
  const mcStarter = (p) => p.locator('.lu-starters .lu-row', { hasText: 'Connor McDavid' });
  const count = await tiles(page).count();
  let day = -1;
  for (let i = 0; i < count && day < 0; i++) {
    await tiles(page).nth(i).click();
    if (await mcStarter(page).count()) day = i;
  }
  const inLineup = async (p) => (await mcStarter(p).count()) > 0;
  const benchMcDavid = async (p) => {
    await mcStarter(p).locator('.lu-main').click();
    // The sheet lists its actions directly and closes itself once the change is saved (2026-11-26).
    await p.locator('.sheet').getByRole('button', { name: /^Remove from lineup/ }).click();
    await p.locator('.sheet').waitFor({ state: 'detached', timeout: 10_000 });
  };
  const resetPeriod = (p) => p.getByRole('button', { name: /^Reset (?!Day ).+ to Optimal$/ }).click();
  if (day < 0) {
    console.log('reset check skipped: Connor McDavid has no game in the selected week');
  } else {
    await benchMcDavid(page);
    if ((await inLineup(page)) || (await savedDays(page)) !== 1) fail('manual removal from the lineup was not applied');
    await resetPeriod(page);
    await until(async () => (await inLineup(page)) && (await savedDays(page)) === 0, 'Reset to Optimal did not update the lineup on screen and in saved data');
    if (dialogs.at(-1) !== 'Revert lineup changes?') fail(`reset confirmation wording: ${JSON.stringify(dialogs.at(-1))}`);
    console.log('reset OK: lineup and saved data updated at once; confirmation "Revert lineup changes?"');

    const other = await context.newPage();
    watch(other);
    await other.goto(`${base}#lineup`, { waitUntil: 'domcontentloaded' });
    await other.getByRole('button', { name: 'Set Lineup', exact: true }).click({ timeout: 30_000 });
    await tiles(other).nth(day).click({ timeout: 30_000 });
    await benchMcDavid(page);
    await until(async () => !(await inLineup(other)), 'a lineup change did not reach the other open tab');
    await resetPeriod(other);
    await until(async () => (await inLineup(page)) && (await savedDays(page)) === 0, 'a reset in another tab did not update this tab');
    // A write to the other site's storage (as its open tab would make) must not reach this page.
    await other.evaluate(([k, v]) => localStorage.setItem(k, v), [otherKey, JSON.stringify({ version: 1, roster: [] })]);
    await sleep(500);
    await myTeam();
    if (!/^My Roster\s*1$/.test((await page.locator('.team-tabs .tab', { hasText: 'My Roster' }).innerText()).trim())) fail('a change to the other site\'s storage reached this page');
    await page.getByRole('button', { name: 'Games Optimizer', exact: true }).click();
    await other.evaluate(([k, v]) => localStorage.setItem(k, v), [otherKey, otherSiteData]);
    await other.close();
    console.log('two tabs OK: changes and resets show in every open tab at once');
  }
  // Schedule view (2026-11-23): the same lineup as the Lineup view. Taking McDavid out from his Schedule
  // cell shows in Lineup, and Reset <period> in Lineup puts him back in the Schedule.
  if (day >= 0) {
    await page.getByRole('button', { name: 'Team Schedule', exact: true }).click();
    await page.locator('.sg-scroll').waitFor({ timeout: 30_000 });
    const assigned = page.locator('.sg-scroll .sg-row', { hasText: 'Connor McDavid' }).locator('.sg-cell.on').first();
    if (!(await assigned.count())) fail('Schedule view shows no in-lineup game for Connor McDavid');
    await assigned.click();
    await page.locator('.sheet').getByRole('button', { name: /^Remove from lineup/ }).click();
    await page.locator('.sheet').waitFor({ state: 'detached', timeout: 10_000 });
    await until(async () => (await savedDays(page)) === 1 && (await page.locator('.sg-scroll .sg-row', { hasText: 'Connor McDavid' }).locator('.sg-cell.off').count()) > 0, 'a change from the Schedule view was not saved');
    await page.getByRole('button', { name: 'Set Lineup', exact: true }).click();
    await page.locator('.lu-daily').waitFor();
    await resetPeriod(page);
    await page.getByRole('button', { name: 'Team Schedule', exact: true }).click();
    await until(async () => (await savedDays(page)) === 0 && (await page.locator('.sg-scroll .sg-row', { hasText: 'Connor McDavid' }).locator('.sg-cell.off').count()) === 0, 'Reset in the Lineup view did not reach the Schedule view');
    await page.getByRole('button', { name: 'Set Lineup', exact: true }).click();
    console.log('schedule OK: a change from the Schedule view is saved, and Reset in Lineup shows in Schedule');

    // IR from Team Schedule (2026-11-26): the cell's panel offers the same Move to IR as Set Lineup,
    // with its confirmation; Cancel changes nothing, confirming moves the player to IR (then back).
    await page.getByRole('button', { name: 'Team Schedule', exact: true }).click();
    const onIr = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)).roster[0].onIr === true, siteKey);
    const mcCell = () => page.locator('.sg-scroll .sg-row', { hasText: 'Connor McDavid' }).locator('.sg-cell').first();
    const sheet = page.locator('.sheet');
    await mcCell().click();
    const toIr = sheet.getByRole('button', { name: /^Move to IR/ });
    if (!(await toIr.isEnabled())) fail('Team Schedule panel does not offer Move to IR');
    await toIr.click();
    if (!/games fit your lineup/.test(await sheet.innerText())) fail('Move to IR confirmation (before/after games) not shown from Team Schedule');
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    if (await onIr()) fail('cancelling Move to IR from Team Schedule changed the roster');
    await sheet.getByRole('button', { name: /^Move to IR/ }).click();
    await sheet.locator('.sheet-actions').getByRole('button', { name: 'Move to IR' }).click();
    await sheet.getByText('What changed').waitFor();
    if (!(await onIr())) fail('confirming Move to IR from Team Schedule did not move the player to IR');
    await sheet.getByRole('button', { name: 'Done' }).click();
    await page.locator('.sg-scroll .sg-row.sg-ir', { hasText: 'Connor McDavid' }).waitFor({ timeout: 5_000 });
    await mcCell().click();
    const offIr = sheet.getByRole('button', { name: /^Move off IR/ });
    if (!(await offIr.count())) fail('Team Schedule panel for an IR player does not offer Move off IR');
    await offIr.click();
    await sheet.locator('.sheet-actions').getByRole('button', { name: 'Move off IR' }).click();
    await sheet.getByRole('button', { name: 'Done' }).click();
    if (await onIr()) fail('Move off IR from Team Schedule did not restore the player');
    await page.getByRole('button', { name: 'Set Lineup', exact: true }).click();
    console.log('team schedule IR OK: Move to IR offered, Cancel keeps the roster, confirm moves to IR (IR section, Move off IR)');
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
  for (const tab of ['Grid', 'Lineup', 'Trade Lab']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(1500);
  }
  await page.getByRole('button', { name: 'My Team', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.waitForTimeout(3000);
  const views = gaHits.filter((h) => h.en === 'page_view');
  console.log(`analytics: ${gaHits.length} GA4 hits captured (not sent to Google); page_view ${views.length}`);
  for (const v of views) console.log(`  page_view ${v.dl} | ${v.dt}`);
} finally {
  await browser.close();
}
if (errors.length) fail(`browser errors:\n${errors.join('\n')}`);
console.log(`PASS ${base}`);
