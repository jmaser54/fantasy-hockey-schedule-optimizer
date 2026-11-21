/** Validate the committed dataset (public/data) the same way the app does at load time. */
import { readFile } from 'node:fs/promises';
import { buildDataset } from '../src/data/load.ts';
import { validateSkaterStats } from '../src/data/validate.ts';

const schedule = JSON.parse(await readFile('public/data/schedule.json', 'utf8'));
const players = JSON.parse(await readFile('public/data/players.json', 'utf8'));
const data = buildDataset(schedule, players);
console.log(`OK: ${data.schedule.games.length} games, ${data.teams.length} teams, ${data.players.length} players (fetched ${data.scheduleFetchedAt})`);
for (const w of data.warnings.slice(0, 10)) console.log(`warning: ${w}`);

// Player Evaluator stats: validated when present. The file is created by the
// first successful refresh after the stats step was added.
let statsRaw: string | undefined;
try {
  statsRaw = await readFile('public/data/skater-stats.json', 'utf8');
} catch {
  console.log('warning: public/data/skater-stats.json not present yet');
}
if (statsRaw !== undefined) {
  const stats = JSON.parse(statsRaw);
  const v = validateSkaterStats(stats, { season: data.season, teamIds: new Set(data.teams.map((t) => t.id)) });
  for (const w of v.warnings.slice(0, 10)) console.log(`warning: ${w}`);
  if (v.errors.length) {
    console.error(`Skater stats failed validation:\n${v.errors.slice(0, 20).join('\n')}`);
    process.exit(1);
  }
  console.log(`OK: ${stats.skaters.length} skaters with stats (fetched ${stats.fetchedAt})`);
}
