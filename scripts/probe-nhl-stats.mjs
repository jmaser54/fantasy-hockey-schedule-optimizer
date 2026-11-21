/**
 * Player Evaluator data proof of concept (investigation only; the app doesn't use it).
 *
 * Probes the NHL Stats REST API (api.nhle.com/stats/rest) skater reports for
 * one season and game type, and prints a report: fields and types, totals,
 * pagination behaviour, player-ID uniqueness, overlap between reports, field
 * agreement, traded players, and coverage against the bundled player
 * directory (public/data/players.json). Raw samples go to data-raw/stats-probe/.
 *
 *   node scripts/probe-nhl-stats.mjs
 *   SEASON=20262027 GAME_TYPE=2 node scripts/probe-nhl-stats.mjs
 *
 * Run by .github/workflows/probe-nhl-stats.yml (the dev container can't reach
 * the NHL APIs). No dependencies.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const SEASON = process.env.SEASON ?? '20262027';
const GAME_TYPE = Number(process.env.GAME_TYPE ?? 2);
const BASE = 'https://api.nhle.com/stats/rest/en';
const REPORTS = ['summary', 'realtime', 'faceoffwins', 'faceoffpercentages'];
const RAW = 'data-raw/stats-probe';
const PAGE = 100;

const out = [];
const log = (s = '') => { out.push(s); console.log(s); };
const result = { season: SEASON, gameType: GAME_TYPE, fetchedAt: new Date().toISOString(), reports: {} };

async function getJson(url) {
  let last;
  for (let i = 0; i < 4; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    try {
      const t0 = Date.now();
      const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'fantasy-playoff-optimizer stats probe' } });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url} :: ${text.slice(0, 200)}`);
      return { body: JSON.parse(text), ms: Date.now() - t0, bytes: text.length };
    } catch (e) { last = e; }
  }
  throw last;
}

const cayenne = (extra = '') => `gameTypeId=${GAME_TYPE} and seasonId<=${SEASON} and seasonId>=${SEASON}${extra}`;
function url(report, { start = 0, limit = PAGE, sort = 'playerId', aggregate = false, extra = '' } = {}) {
  const p = new URLSearchParams({
    isAggregate: String(aggregate),
    isGame: 'false',
    start: String(start),
    limit: String(limit),
    cayenneExp: cayenne(extra),
  });
  if (sort) p.set('sort', JSON.stringify([{ property: sort, direction: 'ASC' }]));
  return `${BASE}/skater/${report}?${p}`;
}

function describeFields(rows) {
  const fields = {};
  for (const r of rows) for (const [k, v] of Object.entries(r)) {
    const f = (fields[k] ??= { types: new Set(), nulls: 0, min: undefined, max: undefined, example: undefined, distinct: new Set() });
    if (v === null || v === undefined) { f.nulls++; continue; }
    f.types.add(Number.isInteger(v) ? 'int' : typeof v === 'number' ? 'float' : typeof v);
    if (typeof v === 'number') { f.min = f.min === undefined ? v : Math.min(f.min, v); f.max = f.max === undefined ? v : Math.max(f.max, v); }
    if (f.example === undefined) f.example = v;
    if (f.distinct.size < 12) f.distinct.add(typeof v === 'string' ? v.slice(0, 30) : v);
  }
  return Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, {
    types: [...f.types].join('|') || 'null', nulls: f.nulls, min: f.min, max: f.max, example: f.example,
    distinct: f.distinct.size < 12 ? [...f.distinct] : undefined,
  }]));
}

async function fetchAll(report, opts = {}) {
  const rows = [];
  let total;
  for (let start = 0; ; start += PAGE) {
    const { body } = await getJson(url(report, { ...opts, start, limit: PAGE }));
    if (!Array.isArray(body.data) || typeof body.total !== 'number') throw new Error(`${report}: unexpected shape ${JSON.stringify(Object.keys(body))}`);
    total = body.total;
    rows.push(...body.data);
    if (body.data.length < PAGE || rows.length >= total) break;
    if (start > 20000) throw new Error(`${report}: pagination did not end`);
  }
  return { rows, total };
}

const ids = (rows) => rows.map((r) => r.playerId);
const dupes = (list) => { const s = new Set(), d = new Set(); for (const x of list) (s.has(x) ? d : s).add(x); return [...d]; };

async function main() {
  await mkdir(RAW, { recursive: true });
  log(`NHL Stats REST probe: season ${SEASON}, gameTypeId ${GAME_TYPE}, ${result.fetchedAt}`);
  log(`Base: ${BASE}/skater/{report}`);

  // Season sanity: does the API list the season?
  try {
    const { body } = await getJson(`${BASE}/season?sort=${encodeURIComponent('[{"property":"id","direction":"DESC"}]')}&limit=3`);
    log(`Seasons endpoint (latest 3): ${JSON.stringify((body.data ?? []).map((s) => ({ id: s.id, startDate: s.startDate, regularSeasonEndDate: s.regularSeasonEndDate, numberOfGames: s.numberOfGames })))}`);
  } catch (e) { log(`Seasons endpoint failed: ${e.message}`); }

  const byReport = {};
  for (const report of REPORTS) {
    log(`\n=== ${report} ===`);
    const r = (result.reports[report] = {});
    // 1. One request for everything (limit=-1)
    try {
      const all = await getJson(url(report, { limit: -1 }));
      r.limitAll = { total: all.body.total, rows: all.body.data.length, ms: all.ms, bytes: all.bytes };
      log(`limit=-1: total ${all.body.total}, rows ${all.body.data.length}, ${all.ms} ms, ${(all.bytes / 1024).toFixed(0)} KB${all.body.data.length < all.body.total ? '  <-- CAPPED, not a full fetch' : ''}`);
      r.limitAllRows = all.body.data;
      await writeFile(`${RAW}/${report}-all.json`, JSON.stringify(all.body));
    } catch (e) { log(`limit=-1 failed: ${e.message}`); r.limitAllError = e.message; }
    // 2. Paginated with a stable sort
    try {
      const pag = await fetchAll(report, { sort: 'playerId' });
      const d = dupes(ids(pag.rows));
      r.paginated = { total: pag.total, rows: pag.rows.length, duplicateIds: d.length };
      log(`paginated (limit ${PAGE}, sort playerId): total ${pag.total}, rows ${pag.rows.length}, duplicate playerIds ${d.length}${d.length ? ' e.g. ' + d.slice(0, 5) : ''}`);
      byReport[report] = pag.rows;
      await writeFile(`${RAW}/${report}-paginated.json`, JSON.stringify(pag.rows));
      if (r.limitAllRows) {
        const b = new Set(ids(pag.rows));
        log(`  limit=-1 rows all inside the paginated set: ${r.limitAllRows.every((x) => b.has(x.playerId))}`);
        delete r.limitAllRows;
      }
    } catch (e) { log(`paginated failed: ${e.message}`); r.paginatedError = e.message; if (r.limitAllRows) byReport[report] = r.limitAllRows; delete r.limitAllRows; }
    // 3. Pagination WITHOUT a sort: does it drift?
    try {
      const pag = await fetchAll(report, { sort: '' });
      const d = dupes(ids(pag.rows));
      const missing = new Set(ids(byReport[report] ?? [])); ids(pag.rows).forEach((x) => missing.delete(x));
      r.unsortedPagination = { rows: pag.rows.length, duplicateIds: d.length, missing: missing.size };
      log(`paginated WITHOUT sort: rows ${pag.rows.length}, duplicate ids ${d.length}, missing ids ${missing.size}`);
    } catch (e) { log(`unsorted pagination failed: ${e.message}`); }

    const rows = byReport[report] ?? [];
    if (!rows.length) continue;
    r.fields = describeFields(rows);
    log(`fields (${Object.keys(r.fields).length}):`);
    for (const [k, f] of Object.entries(r.fields)) {
      log(`  ${k.padEnd(28)} ${f.types.padEnd(12)} nulls ${String(f.nulls).padStart(4)}  ${f.min !== undefined ? `range ${f.min}..${f.max}` : ''}${f.distinct ? `  values ${JSON.stringify(f.distinct)}` : ''}  e.g. ${JSON.stringify(f.example)}`);
    }
    const d = dupes(ids(rows));
    log(`rows ${rows.length}; distinct playerIds ${new Set(ids(rows)).size}; duplicate ids ${d.length}`);
    if (d.length) log(`  duplicate example rows: ${JSON.stringify(rows.filter((x) => x.playerId === d[0]))}`);
    log(`sample rows: ${JSON.stringify(rows.slice(0, 2))}`);
    const pos = rows.reduce((a, x) => ((a[x.positionCode ?? '?'] = (a[x.positionCode ?? '?'] ?? 0) + 1), a), {});
    log(`positionCode counts: ${JSON.stringify(pos)}`);
    const seasons = [...new Set(rows.map((x) => x.seasonId))], gtypes = [...new Set(rows.map((x) => x.gameTypeId))];
    log(`seasonId values: ${JSON.stringify(seasons)}; gameTypeId values: ${JSON.stringify(gtypes)}`);
    const multiTeam = rows.filter((x) => typeof x.teamAbbrevs === 'string' && x.teamAbbrevs.includes(','));
    log(`rows with more than one team in teamAbbrevs: ${multiTeam.length}${multiTeam.length ? ' e.g. ' + JSON.stringify(multiTeam.slice(0, 3).map((x) => [x.playerId, x.skaterFullName, x.teamAbbrevs, x.gamesPlayed])) : ''}`);
    const zeroGp = rows.filter((x) => !x.gamesPlayed).length;
    log(`rows with gamesPlayed 0/missing: ${zeroGp}`);
  }

  // isAggregate=true vs false (traded players)
  try {
    const agg = await fetchAll('summary', { aggregate: true });
    const non = byReport.summary ?? [];
    log(`\nsummary isAggregate=true (paginated): total ${agg.total}, rows ${agg.rows.length} (isAggregate=false: ${non.length}); duplicate ids ${dupes(ids(agg.rows)).length}`);
    const nonById = new Map(non.map((x) => [x.playerId, x]));
    const diff = agg.rows.filter((a) => { const n = nonById.get(a.playerId); return !n || n.gamesPlayed !== a.gamesPlayed || n.points !== a.points || n.teamAbbrevs !== a.teamAbbrevs; });
    log(`  rows whose GP/points differ between aggregate modes: ${diff.length}${diff.length ? ' e.g. ' + JSON.stringify(diff.slice(0, 3)) : ''}`);
  } catch (e) { log(`aggregate comparison failed: ${e.message}`); }

  // Cross-report overlap and field agreement
  log('\n=== cross-report ===');
  const sets = Object.fromEntries(Object.entries(byReport).map(([k, v]) => [k, new Set(ids(v))]));
  const names = Object.keys(sets);
  for (const a of names) for (const b of names) if (a < b) {
    const inter = [...sets[a]].filter((x) => sets[b].has(x)).length;
    log(`${a} (${sets[a].size}) ∩ ${b} (${sets[b].size}) = ${inter}; only ${a}: ${sets[a].size - inter}; only ${b}: ${sets[b].size - inter}`);
  }
  const summaryById = new Map((byReport.summary ?? []).map((x) => [x.playerId, x]));
  for (const report of names.filter((n) => n !== 'summary')) {
    const rows = byReport[report];
    const common = Object.keys(rows[0] ?? {}).filter((k) => summaryById.size && k in [...summaryById.values()][0]);
    const mismatches = {};
    for (const row of rows) {
      const s = summaryById.get(row.playerId); if (!s) continue;
      for (const k of common) if (JSON.stringify(s[k]) !== JSON.stringify(row[k])) (mismatches[k] ??= []).push([row.playerId, s[k], row[k]]);
    }
    log(`${report}: fields shared with summary: ${common.join(', ')}`);
    log(`  disagreements with summary: ${Object.keys(mismatches).length ? Object.entries(mismatches).map(([k, v]) => `${k}: ${v.length} (e.g. ${JSON.stringify(v.slice(0, 3))})`).join('; ') : 'none'}`);
    const notInSummary = rows.filter((x) => !summaryById.has(x.playerId));
    if (notInSummary.length) log(`  in ${report} but not summary: ${notInSummary.length} e.g. ${JSON.stringify(notInSummary.slice(0, 3))}`);
  }
  // Faceoff report coverage: who's missing from it, and what do they look like in summary?
  for (const report of ['faceoffwins', 'faceoffpercentages']) {
    if (!byReport[report] || !summaryById.size) continue;
    const s = sets[report];
    const missing = [...summaryById.values()].filter((x) => !s.has(x.playerId));
    const missingPos = missing.reduce((a, x) => ((a[x.positionCode] = (a[x.positionCode] ?? 0) + 1), a), {});
    log(`${report}: summary players missing from it: ${missing.length} by position ${JSON.stringify(missingPos)}; e.g. ${JSON.stringify(missing.slice(0, 3).map((x) => [x.playerId, x.skaterFullName, x.positionCode, x.gamesPlayed, x.faceoffWinPct]))}`);
    const withZeroFo = byReport[report].filter((x) => (x.totalFaceoffs ?? x.faceoffs ?? 0) === 0).length;
    log(`  rows in ${report} with zero total faceoffs: ${withZeroFo}`);
  }


  // Page-size cap, filter behaviour, arithmetic identities
  log('\n=== API behaviour and internal consistency ===');
  for (const lim of [101, 500, 1000]) {
    try { const { body } = await getJson(url('summary', { limit: lim })); log(`summary limit=${lim}: rows ${body.data.length} of ${body.total}`); }
    catch (e) { log(`summary limit=${lim} failed: ${e.message}`); }
  }
  for (const [label, extraCay] of [['preseason gameTypeId=1', 1], ['playoffs gameTypeId=3', 3]]) {
    try {
      const p = new URLSearchParams({ isAggregate: 'false', isGame: 'false', start: '0', limit: '5', sort: JSON.stringify([{ property: 'points', direction: 'DESC' }]), cayenneExp: `gameTypeId=${extraCay} and seasonId<=${SEASON} and seasonId>=${SEASON}` });
      const { body } = await getJson(`${BASE}/skater/summary?${p}`);
      log(`${label}: total ${body.total}; top: ${JSON.stringify(body.data.slice(0, 2).map((x) => [x.skaterFullName, x.gamesPlayed, x.points]))}`);
    } catch (e) { log(`${label} failed: ${e.message}`); }
  }
  try {
    const p = new URLSearchParams({ isAggregate: 'false', isGame: 'false', start: '0', limit: '5', cayenneExp: `seasonId<=${SEASON} and seasonId>=${SEASON}` });
    const { body } = await getJson(`${BASE}/skater/summary?${p}`);
    log(`no gameTypeId filter: total ${body.total} (regular season ${byReport.summary?.length}) - filter must always be sent`);
  } catch (e) { log(`no gameTypeId filter failed: ${e.message}`); }
  try {
    const { body } = await getJson(`${BASE}/skater/summary?limit=5&cayenneExp=${encodeURIComponent('seasonId=20262027 and gameTypeId=2')}`);
    log(`simple cayenneExp (seasonId=.. and gameTypeId=2), no sort: total ${body.total}`);
  } catch (e) { log(`simple cayenneExp failed: ${e.message}`); }
  try {
    const p = new URLSearchParams({ start: '0', limit: '5', cayenneExp: `gameTypeId=2 and seasonId=${SEASON} and bogusField=1` });
    const r = await fetch(`${BASE}/skater/summary?${p}`); log(`bad cayenne field: HTTP ${r.status} ${(await r.text()).slice(0, 150)}`);
  } catch (e) { log(`bad cayenne probe failed: ${e.message}`); }

  const S = byReport.summary ?? [], R = new Map((byReport.realtime ?? []).map((x) => [x.playerId, x])), F = new Map((byReport.faceoffwins ?? []).map((x) => [x.playerId, x]));
  const bad = (name, pred) => { const b = S.filter(pred); log(`${name}: ${b.length} violations${b.length ? ' e.g. ' + JSON.stringify(b.slice(0, 3).map((x) => x.playerId)) : ''}`); };
  bad('goals + assists = points', (x) => x.goals + x.assists !== x.points);
  bad('evGoals + ppGoals + shGoals = goals', (x) => x.evGoals + x.ppGoals + x.shGoals !== x.goals);
  bad('ppPoints >= ppGoals and shPoints >= shGoals', (x) => x.ppPoints < x.ppGoals || x.shPoints < x.shGoals);
  bad('evPoints + ppPoints + shPoints = points', (x) => x.evPoints + x.ppPoints + x.shPoints !== x.points);
  bad('shootingPct = goals/shots (±0.0001, null iff 0 shots)', (x) => x.shots === 0 ? x.shootingPct !== null : Math.abs(x.shootingPct - x.goals / x.shots) > 1e-4);
  bad('pointsPerGame = points/GP (±0.0001)', (x) => Math.abs(x.pointsPerGame - x.points / x.gamesPlayed) > 1e-4);
  bad('faceoffwins: wins + losses = total', (x) => { const f = F.get(x.playerId); return f && f.totalFaceoffWins + f.totalFaceoffLosses !== f.totalFaceoffs; });
  bad('faceoffWinPct = wins/total (null iff 0 faceoffs)', (x) => { const f = F.get(x.playerId); if (!f) return false; return f.totalFaceoffs === 0 ? x.faceoffWinPct !== null : Math.abs(x.faceoffWinPct - f.totalFaceoffWins / f.totalFaceoffs) > 1e-4; });
  bad('realtime/faceoffwins gamesPlayed equals summary', (x) => (R.get(x.playerId)?.gamesPlayed ?? x.gamesPlayed) !== x.gamesPlayed || (F.get(x.playerId)?.gamesPlayed ?? x.gamesPlayed) !== x.gamesPlayed);
  bad('realtime otGoals equals summary', (x) => R.has(x.playerId) && R.get(x.playerId).otGoals !== x.otGoals);
  const tot = (k, rows) => rows.reduce((a, x) => a + (x[k] ?? 0), 0);
  log(`league totals: GP ${tot('gamesPlayed', S)}, goals ${tot('goals', S)}, points ${tot('points', S)}, shots ${tot('shots', S)}, hits ${tot('hits', [...R.values()])}, blocks ${tot('blockedShots', [...R.values()])}, FOW ${tot('totalFaceoffWins', [...F.values()])}, FOL ${tot('totalFaceoffLosses', [...F.values()])}`);
  const gp = S.map((x) => x.gamesPlayed); log(`gamesPlayed range ${Math.min(...gp)}..${Math.max(...gp)}; positions ${JSON.stringify(S.reduce((a, x) => ((a[x.positionCode] = (a[x.positionCode] ?? 0) + 1), a), {}))}`);
  const teams = new Set(S.flatMap((x) => String(x.teamAbbrevs).split(','))); log(`distinct teams in teamAbbrevs: ${teams.size} ${JSON.stringify([...teams].sort())}`);

  // Coverage against the bundled player directory
  try {
    const players = JSON.parse(await readFile('public/data/players.json', 'utf8'));
    const dirSkaters = players.players.filter((p) => p.nhlId !== undefined && !(p.positions.length === 1 && p.positions[0] === 'G'));
    const dirById = new Map(players.players.filter((p) => p.nhlId !== undefined).map((p) => [p.nhlId, p]));
    const statIds = sets.summary ?? new Set();
    const withStats = dirSkaters.filter((p) => statIds.has(p.nhlId));
    const activeNoStats = dirSkaters.filter((p) => !statIds.has(p.nhlId) && !p.inactive);
    const statsNotInDir = [...statIds].filter((id) => !dirById.has(id));
    log(`\n=== coverage vs public/data/players.json (fetched ${players.fetchedAt}) ===`);
    log(`directory skaters with an NHL id: ${dirSkaters.length}; with a summary row: ${withStats.length}; active-roster skaters with no row (likely 0 GP): ${activeNoStats.length}`);
    log(`  e.g. active with no stats: ${JSON.stringify(activeNoStats.slice(0, 8).map((p) => [p.nhlId, p.name, p.team]))}`);
    log(`summary players not in the directory: ${statsNotInDir.length} e.g. ${JSON.stringify(statsNotInDir.slice(0, 8).map((id) => { const x = summaryById.get(id); return [id, x?.skaterFullName, x?.teamAbbrevs, x?.gamesPlayed]; }))}`);
    const teamMismatch = withStats.filter((p) => { const x = summaryById.get(p.nhlId); const last = String(x.teamAbbrevs ?? '').split(',').at(-1); return last && last !== p.team; });
    log(`directory team differs from the last team in summary.teamAbbrevs: ${teamMismatch.length} e.g. ${JSON.stringify(teamMismatch.slice(0, 5).map((p) => [p.name, p.team, summaryById.get(p.nhlId).teamAbbrevs]))}`);
    result.coverage = { dirSkaters: dirSkaters.length, withStats: withStats.length, activeNoStats: activeNoStats.length, statsNotInDir: statsNotInDir.length };
  } catch (e) { log(`coverage check failed: ${e.message}`); }

  await writeFile(`${RAW}/probe-result.json`, JSON.stringify(result, null, 2));
  await writeFile(`${RAW}/probe-report.txt`, out.join('\n'));
  log('\nDone.');
}

main().catch(async (e) => {
  log(`PROBE FAILED: ${e.stack ?? e}`);
  await mkdir(RAW, { recursive: true });
  await writeFile(`${RAW}/probe-report.txt`, out.join('\n'));
  process.exit(1);
});
