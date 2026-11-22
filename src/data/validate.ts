/**
 * Structural and consistency checks for the bundled dataset. Used by the
 * refresh script (a failing check aborts the write) and by the app at load
 * time (a failing check is surfaced as a data-status error, never ignored).
 */
import { isValidISODate } from '../domain/dates.ts';
import { POSITIONS } from '../domain/types.ts';
import { DATA_VERSION, type PlayersFile, type ScheduleFile, type SkaterStatsFile } from './format.ts';

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

const COUNTING_STATS = ['gamesPlayed', 'goals', 'assists', 'points', 'penaltyMinutes', 'ppPoints', 'shPoints', 'shots', 'hits', 'blockedShots', 'faceoffWins'] as const;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isFraction = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;

/**
 * Player Evaluator skater statistics (public/data/skater-stats.json).
 * `teamIds` checks team codes; `previous` (same season) guards against a
 * snapshot that suddenly lost players, since a skater who has played never
 * drops out of the season's list.
 */
export function validateSkaterStats(
  data: unknown,
  opts: {
    season?: string;
    teamIds?: ReadonlySet<string>;
    previous?: SkaterStatsFile;
    /** Completed seasons only: games per team. The season must be finished (some skater played every game). */
    completeSeasonGames?: number;
  } = {},
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(data)) return { errors: ['Skater stats file is not an object.'], warnings };
  if (data.version !== DATA_VERSION) errors.push(`Unsupported skater stats version ${String(data.version)}.`);
  if (typeof data.season !== 'string' || !/^\d{8}$/.test(data.season)) errors.push('Skater stats file has no season.');
  else if (opts.season && data.season !== opts.season) errors.push(`Skater stats are for season ${data.season}; expected ${opts.season}.`);
  if (data.gameType !== 2) errors.push(`Skater stats are for game type ${String(data.gameType)}; expected 2 (regular season).`);
  if (typeof data.fetchedAt !== 'string' || Number.isNaN(Date.parse(data.fetchedAt))) errors.push('Skater stats file has no valid fetchedAt.');
  if (!Array.isArray(data.skaters)) return { errors: [...errors, 'Skater stats file has no skaters.'], warnings };
  const file = data as unknown as SkaterStatsFile;
  const ids = new Set<number>();
  for (const s of file.skaters) {
    if (!isObj(s) || !isInt(s.nhlId) || typeof s.name !== 'string' || !s.name || !Array.isArray(s.teams) || s.teams.length === 0) {
      errors.push('Malformed skater stats record.');
      continue;
    }
    const who = `${s.name} (${s.nhlId})`;
    if (ids.has(s.nhlId)) errors.push(`Skater ${s.nhlId} appears twice.`);
    ids.add(s.nhlId);
    if (!['C', 'L', 'R', 'D'].includes(s.position as string)) errors.push(`${who} has unknown position ${String(s.position)}.`);
    for (const t of s.teams) if (typeof t !== 'string' || (opts.teamIds && !opts.teamIds.has(t))) errors.push(`${who} has unknown team ${String(t)}.`);
    const bad = COUNTING_STATS.filter((k) => !isInt(s[k]) || (s[k] as number) < 0);
    if (bad.length) {
      errors.push(`${who} has invalid ${bad.join(', ')}.`);
      continue;
    }
    if (!isInt(s.plusMinus)) errors.push(`${who} has invalid plusMinus.`);
    if (s.gamesPlayed < 1) errors.push(`${who} has ${s.gamesPlayed} games played.`);
    if (s.goals + s.assists !== s.points) errors.push(`${who}: goals + assists ≠ points.`);
    if (s.ppPoints + s.shPoints > s.points) errors.push(`${who}: PP + SH points exceed points.`);
    if (s.shots === 0 ? s.shootingPct !== null : !isFraction(s.shootingPct) || Math.abs(s.shootingPct - s.goals / s.shots) > 1e-3) {
      errors.push(`${who} has inconsistent shooting percentage.`);
    }
    if (s.faceoffWinPct !== null && !isFraction(s.faceoffWinPct)) errors.push(`${who} has invalid faceoff percentage.`);
    if (s.faceoffWins > 0 && !s.faceoffWinPct) errors.push(`${who} has faceoff wins but no faceoff percentage.`);
    if (typeof s.toiPerGame !== 'number' || !(s.toiPerGame > 0) || s.toiPerGame > 3600) errors.push(`${who} has invalid time on ice.`);
  }
  if (file.skaters.length === 0) errors.push('Skater stats file has no skaters.');
  if (opts.completeSeasonGames && file.skaters.length > 0) {
    const maxGp = Math.max(...file.skaters.map((s) => (isObj(s) && isInt(s.gamesPlayed) ? s.gamesPlayed : 0)));
    if (maxGp < opts.completeSeasonGames) errors.push(`Season looks incomplete: the most games played is ${maxGp}; expected at least ${opts.completeSeasonGames}.`);
  }
  const prev = opts.previous;
  if (prev && prev.season === file.season && Array.isArray(prev.skaters)) {
    if (file.skaters.length < prev.skaters.length * 0.9) {
      errors.push(`Only ${file.skaters.length} skaters; the previous snapshot had ${prev.skaters.length}.`);
    } else if (file.skaters.length < prev.skaters.length) {
      warnings.push(`${prev.skaters.length - file.skaters.length} fewer skaters than the previous snapshot.`);
    }
  }
  return { errors, warnings };
}
