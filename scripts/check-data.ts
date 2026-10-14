/** Validate the committed dataset (public/data) the same way the app does at load time. */
import { readFile } from 'node:fs/promises';
import { buildDataset } from '../src/data/load.ts';

const schedule = JSON.parse(await readFile('public/data/schedule.json', 'utf8'));
const players = JSON.parse(await readFile('public/data/players.json', 'utf8'));
const data = buildDataset(schedule, players);
console.log(`OK: ${data.schedule.games.length} games, ${data.teams.length} teams, ${data.players.length} players (fetched ${data.scheduleFetchedAt})`);
for (const w of data.warnings.slice(0, 10)) console.log(`warning: ${w}`);
