/**
 * Refresh the bundled NHL dataset (public/data/*.json).
 *
 *   npm run data:refresh            # current season from the config below
 *   SEASON=20262027 npm run data:refresh
 *
 * Fetches from the NHL web API (schedule, teams, rosters) and, optionally,
 * ESPN's fantasy player pool (eligibility). Every response is parsed
 * strictly and the merged result is validated; if validation fails nothing
 * is written. Raw samples and a report go to data-raw/ (git-ignored) for
 * inspection. Run by .github/workflows/refresh-data.yml on a schedule.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DATA_VERSION, type PlayersFile, type ScheduleFile } from '../src/data/format.ts';
import { ESPN_FILTER, espnPlayersUrl, parseEspnPlayers, type EspnPlayer } from '../src/data/pipeline/espn.ts';
import { mergeClubSchedules, NHL_BASE, parseClubSchedule, parseRoster, parseStandingsTeams, type NhlRosterPlayer } from '../src/data/pipeline/nhl.ts';
import { reconcilePlayers } from '../src/data/pipeline/reconcile.ts';
import { validatePlayers, validateSchedule } from '../src/data/validate.ts';
import type { Game } from '../src/domain/types.ts';

const SEASON = process.env.SEASON ?? '20262027';
const ESPN_SEASON = Number(SEASON.slice(4));
const GAMES_PER_TEAM = Number(process.env.GAMES_PER_TEAM ?? 84);
const OUT_DIR = 'public/data';
const RAW_DIR = 'data-raw';
const SKIP_ESPN = process.env.SKIP_ESPN === '1';

const report: string[] = [];
const log = (line: string) => {
  report.push(line);
  console.log(line);
};

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    try {
      const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'fantasy-playoff-optimizer data refresh', ...headers } });
      if (res.status === 404) throw Object.assign(new Error(`404 ${url}`), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if ((err as { fatal?: boolean }).fatal) break;
    }
  }
  throw lastErr;
}

async function saveRaw(name: string, body: unknown) {
  await writeFile(`${RAW_DIR}/${name}`, JSON.stringify(body, null, 2));
}

/** Today's date in US Eastern time (the NHL schedule's date convention). */
function easternToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function readPrevious<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(RAW_DIR, { recursive: true });
  const fetchedAt = new Date().toISOString();
  log(`Season ${SEASON}, fetched ${fetchedAt}`);

  // Teams
  const standings = await getJson(`${NHL_BASE}/standings/now`);
  await saveRaw('standings.json', standings);
  const teams = parseStandingsTeams(standings).sort((a, b) => a.id.localeCompare(b.id));
  log(`Teams: ${teams.length} (${teams.map((t) => t.id).join(' ')})`);

  // Schedules: every team's season; each game must appear in both teams' lists.
  const byTeam = new Map<string, Game[]>();
  for (const t of teams) {
    const body = await getJson(`${NHL_BASE}/club-schedule-season/${t.id}/${SEASON}`);
    if (t.id === teams[0]!.id) await saveRaw(`club-schedule-${t.id}.json`, body);
    const parsed = parseClubSchedule(body, SEASON);
    byTeam.set(t.id, parsed.games);
    for (const s of parsed.skipped) log(`  skipped ${t.id} game ${s.id}: ${s.reason}`);
  }
  const merged = mergeClubSchedules(byTeam);
  if (merged.errors.length) throw new Error(`Schedule reconciliation failed:\n${merged.errors.slice(0, 30).join('\n')}`);
  const schedule: ScheduleFile = {
    version: DATA_VERSION,
    season: SEASON,
    fetchedAt,
    source: `${NHL_BASE}/club-schedule-season/{team}/${SEASON}`,
    teams,
    games: merged.games,
  };
  const sv = validateSchedule(schedule, { expectedGamesPerTeam: GAMES_PER_TEAM });
  sv.warnings.forEach((w) => log(`  warning: ${w}`));
  if (sv.errors.length) throw new Error(`Schedule validation failed:\n${sv.errors.slice(0, 30).join('\n')}`);
  log(`Games: ${schedule.games.length} (${schedule.games[0]?.date} → ${schedule.games.at(-1)?.date})`);
  for (const [s, e] of [['2027-02-22', '2027-03-07'], ['2027-03-08', '2027-03-21'], ['2027-03-22', '2027-04-04']] as const) {
    log(`  ${s}..${e}: ${schedule.games.filter((g) => g.date >= s && g.date <= e).length} games`);
  }

  // Rosters
  const rosterPlayers: NhlRosterPlayer[] = [];
  for (const t of teams) {
    const body = await getJson(`${NHL_BASE}/roster/${t.id}/current`);
    if (t.id === teams[0]!.id) await saveRaw(`roster-${t.id}.json`, body);
    rosterPlayers.push(...parseRoster(body, t.id));
  }
  log(`NHL roster players: ${rosterPlayers.length}`);

  // ESPN eligibility (optional)
  let espn: EspnPlayer[] | undefined;
  if (!SKIP_ESPN) {
    try {
      const body = await getJson(espnPlayersUrl(ESPN_SEASON), { 'x-fantasy-filter': ESPN_FILTER });
      await saveRaw('espn-players-sample.json', Array.isArray(body) ? body.slice(0, 25) : body);
      espn = parseEspnPlayers(body);
      log(`ESPN players: ${espn.length}`);
      if (Array.isArray(body)) {
        const keys = new Set<string>();
        for (const p of body.slice(0, 200)) if (p && typeof p === 'object') Object.keys(p).forEach((k) => keys.add(k));
        log(`  ESPN fields: ${[...keys].sort().join(' ')}`);
        log(`  ESPN injury statuses: ${JSON.stringify(espn.reduce<Record<string, number>>((a, p) => ((a[p.injuryStatus ?? 'none'] = (a[p.injuryStatus ?? 'none'] ?? 0) + 1), a), {}))}`);
      }
    } catch (err) {
      log(`ESPN unavailable: ${(err as Error).message}`);
    }
  }

  const previous = await readPrevious<PlayersFile>(`${OUT_DIR}/players.json`);
  const rec = reconcilePlayers({ nhl: rosterPlayers, espn, previous: previous?.season === SEASON ? previous : undefined, today: easternToday() });
  rec.report.forEach((l) => log(`  ${l}`));
  rec.warnings.forEach((w) => log(`  warning: ${w}`));
  const players: PlayersFile = {
    version: DATA_VERSION,
    season: SEASON,
    fetchedAt,
    sources: { rosters: `${NHL_BASE}/roster/{team}/current`, eligibility: rec.eligibility },
    players: rec.players,
  };
  const pv = validatePlayers(players, new Set(teams.map((t) => t.id)));
  pv.warnings.slice(0, 20).forEach((w) => log(`  warning: ${w}`));
  if (pv.errors.length) throw new Error(`Player validation failed:\n${pv.errors.slice(0, 30).join('\n')}`);
  log(`Directory: ${players.players.length} players; eligibility: ${rec.eligibility.detail}`);

  await writeFile(`${OUT_DIR}/schedule.json`, JSON.stringify(schedule));
  await writeFile(`${OUT_DIR}/players.json`, JSON.stringify(players));
  await writeFile(`${RAW_DIR}/report.txt`, report.join('\n'));
  log('Wrote public/data/schedule.json and public/data/players.json');
}

main().catch(async (err) => {
  log(`FAILED: ${(err as Error).stack ?? String(err)}`);
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(`${RAW_DIR}/report.txt`, report.join('\n'));
  process.exit(1);
});
