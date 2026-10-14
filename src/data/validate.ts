/**
 * Structural and consistency checks for the bundled dataset. Used by the
 * refresh script (a failing check aborts the write) and by the app at load
 * time (a failing check is surfaced as a data-status error, never ignored).
 */
import { isValidISODate } from '../domain/dates.ts';
import { POSITIONS } from '../domain/types.ts';
import { DATA_VERSION, type PlayersFile, type ScheduleFile } from './format.ts';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateSchedule(data: unknown, opts: { expectedGamesPerTeam?: number } = {}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(data)) return { errors: ['Schedule file is not an object.'], warnings };
  if (data.version !== DATA_VERSION) errors.push(`Unsupported schedule version ${String(data.version)}.`);
  if (!Array.isArray(data.teams) || !Array.isArray(data.games)) {
    errors.push('Schedule file is missing teams or games.');
    return { errors, warnings };
  }
  const file = data as unknown as ScheduleFile;
  const teamIds = new Set<string>();
  for (const t of file.teams) {
    if (!isObj(t) || typeof t.id !== 'string' || typeof t.name !== 'string') {
      errors.push('Malformed team record.');
      continue;
    }
    if (teamIds.has(t.id)) errors.push(`Duplicate team ${t.id}.`);
    teamIds.add(t.id);
  }
  const ids = new Set<string>();
  const teamDate = new Set<string>();
  const perTeam = new Map<string, number>([...teamIds].map((t) => [t, 0]));
  for (const g of file.games) {
    if (!isObj(g) || typeof g.id !== 'string' || !isValidISODate(g.date) || typeof g.home !== 'string' || typeof g.away !== 'string') {
      errors.push(`Malformed game record ${isObj(g) ? String(g.id) : ''}.`);
      continue;
    }
    if (ids.has(g.id)) errors.push(`Duplicate game ${g.id}.`);
    ids.add(g.id);
    if (g.home === g.away) errors.push(`Game ${g.id} has the same home and away team.`);
    for (const t of [g.home, g.away]) {
      if (!teamIds.has(t)) errors.push(`Game ${g.id} references unknown team ${t}.`);
      const key = `${t}|${g.date}`;
      if (teamDate.has(key)) errors.push(`${t} has two games on ${g.date}.`);
      teamDate.add(key);
      perTeam.set(t, (perTeam.get(t) ?? 0) + 1);
    }
  }
  if (opts.expectedGamesPerTeam) {
    for (const [t, n] of perTeam) {
      if (n !== opts.expectedGamesPerTeam) errors.push(`${t} has ${n} games; expected ${opts.expectedGamesPerTeam}.`);
    }
  } else {
    const counts = new Set(perTeam.values());
    if (counts.size > 1) warnings.push(`Teams have unequal game counts (${[...counts].sort().join(', ')}).`);
  }
  if (file.games.length === 0) errors.push('Schedule has no games.');
  return { errors, warnings };
}

export function validatePlayers(data: unknown, teamIds: ReadonlySet<string>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(data)) return { errors: ['Players file is not an object.'], warnings };
  if (data.version !== DATA_VERSION) errors.push(`Unsupported players version ${String(data.version)}.`);
  if (!Array.isArray(data.players)) return { errors: [...errors, 'Players file has no players.'], warnings };
  const file = data as unknown as PlayersFile;
  const ids = new Set<string>();
  const nhlIds = new Set<number>();
  const espnIds = new Set<number>();
  for (const p of file.players) {
    if (!isObj(p) || typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.team !== 'string' || !Array.isArray(p.positions)) {
      errors.push('Malformed player record.');
      continue;
    }
    if (ids.has(p.id)) errors.push(`Duplicate player ${p.id}.`);
    ids.add(p.id);
    if (p.nhlId !== undefined) {
      if (nhlIds.has(p.nhlId)) errors.push(`NHL id ${p.nhlId} appears twice.`);
      nhlIds.add(p.nhlId);
    }
    if (p.espnId !== undefined) {
      if (espnIds.has(p.espnId)) errors.push(`ESPN id ${p.espnId} appears twice.`);
      espnIds.add(p.espnId);
    }
    if (!teamIds.has(p.team)) errors.push(`${p.name} is on unknown team ${p.team}.`);
    if (p.positions.length === 0) warnings.push(`${p.name} has no eligible positions.`);
    if (p.positions.some((x) => !POSITIONS.includes(x))) errors.push(`${p.name} has an unknown position.`);
    for (const s of p.stints ?? []) {
      if (!teamIds.has(s.team)) errors.push(`${p.name} has a stint on unknown team ${s.team}.`);
      if ((s.from && !isValidISODate(s.from)) || (s.to && !isValidISODate(s.to))) errors.push(`${p.name} has a malformed stint.`);
    }
  }
  if (file.players.length < 500) warnings.push(`Only ${file.players.length} players in the directory.`);
  return { errors, warnings };
}
