/**
 * Fetch Player Evaluator skater stats for completed regular seasons (static snapshots).
 *
 *   npm run data:historical                     # every season in HISTORICAL_SEASONS
 *   SEASONS=20242025 npm run data:historical    # one season
 *
 * Uses the same NHL Stats REST reports, join and validation as the current-season refresh
 * (scripts/refresh-data.ts), plus a completeness check (some skater played every game). Records are
 * keyed by NHL player id. A season is written to public/data/skater-stats-<season>.json only if it
 * passes validation; any failure exits non-zero and writes nothing for that season. Not part of the
 * scheduled refresh: run by .github/workflows/historical-stats.yml on demand.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DATA_VERSION, HISTORICAL_SEASONS, skaterStatsPath, type PlayersFile, type ScheduleFile, type SkaterStatsFile } from '../src/data/format.ts';
import { fetchStatsReport, joinSkaterStats, STATS_BASE, STATS_REPORTS, type StatsReport } from '../src/data/pipeline/stats.ts';
import { validateSkaterStats } from '../src/data/validate.ts';

const RAW_DIR = 'data-raw';
// SEASONS unset or empty (the workflow's default input) means every historical season.
const list = (process.env.SEASONS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const wanted = list.length ? list : undefined;
const seasons = HISTORICAL_SEASONS.filter((s) => !wanted || wanted.includes(s.season));
if (seasons.length === 0) throw new Error('No seasons selected');
if (wanted && seasons.length !== wanted.length) throw new Error(`Unknown season in SEASONS=${process.env.SEASONS}; known: ${HISTORICAL_SEASONS.map((s) => s.season).join(', ')}`);

const report: string[] = [];
const log = (line: string) => {
  report.push(line);
  console.log(line);
};

async function getJson(url: string): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    try {
      const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'fantasy-playoff-optimizer historical stats' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  const schedule = JSON.parse(await readFile('public/data/schedule.json', 'utf8')) as ScheduleFile;
  const players = JSON.parse(await readFile('public/data/players.json', 'utf8')) as PlayersFile;
  const teamIds = new Set(schedule.teams.map((t) => t.id));
  const directoryIds = new Set(players.players.map((p) => p.nhlId).filter((id): id is number => id !== undefined));
  let failed = 0;
  for (const { season, teamGames } of seasons) {
    try {
      const fetchedAt = new Date().toISOString();
      const reports = {} as Record<StatsReport, Record<string, unknown>[]>;
      for (const r of STATS_REPORTS) {
        const { rows, firstPage } = await fetchStatsReport(getJson, r, season);
        await writeFile(`${RAW_DIR}/stats-${season}-${r}-page1.json`, JSON.stringify(firstPage, null, 2));
        reports[r] = rows;
      }
      const file: SkaterStatsFile = {
        version: DATA_VERSION,
        season,
        gameType: 2,
        fetchedAt,
        source: `${STATS_BASE}/skater/{${STATS_REPORTS.join(',')}} (season ${season})`,
        skaters: joinSkaterStats(reports, season),
      };
      const v = validateSkaterStats(file, { season, teamIds, completeSeasonGames: teamGames });
      v.warnings.forEach((w) => log(`  ${season} warning: ${w}`));
      if (v.errors.length) throw new Error(`validation failed:\n${v.errors.slice(0, 30).join('\n')}`);
      const maxGp = Math.max(...file.skaters.map((s) => s.gamesPlayed));
      const inDirectory = file.skaters.filter((s) => directoryIds.has(s.nhlId)).length;
      await writeFile(`public/${skaterStatsPath(season)}`, JSON.stringify(file));
      log(`${season}: wrote public/${skaterStatsPath(season)}: ${file.skaters.length} skaters, most GP ${maxGp}, ${inDirectory} in the current player directory`);
    } catch (err) {
      failed++;
      log(`${season}: FAILED, nothing written: ${(err as Error).message}`);
    }
  }
  await writeFile(`${RAW_DIR}/historical-report.txt`, report.join('\n'));
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
