import { ScheduleIndex } from '../domain/schedule.ts';
import type { Player, Team } from '../domain/types.ts';
import type { PlayersFile, ScheduleFile } from './format.ts';
import { validatePlayers, validateSchedule } from './validate.ts';

export type DirectoryPlayer = PlayersFile['players'][number];

export interface Dataset {
  schedule: ScheduleIndex;
  teams: Team[];
  season: string;
  scheduleFetchedAt: string;
  playersFetchedAt: string;
  eligibilityDetail: string;
  players: DirectoryPlayer[];
  warnings: string[];
}

export type DataStatus =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: Dataset; stale: boolean };

/** Data older than this is shown as stale. The refresh job runs daily. */
export const STALE_AFTER_MS = 3 * 86_400_000;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

export function buildDataset(scheduleRaw: unknown, playersRaw: unknown): Dataset {
  const sv = validateSchedule(scheduleRaw);
  if (sv.errors.length) throw new Error(`Schedule data failed validation: ${sv.errors[0]}`);
  const sched = scheduleRaw as ScheduleFile;
  const teamIds = new Set(sched.teams.map((t) => t.id));
  const pv = validatePlayers(playersRaw, teamIds);
  if (pv.errors.length) throw new Error(`Player data failed validation: ${pv.errors[0]}`);
  const players = playersRaw as PlayersFile;
  return {
    schedule: new ScheduleIndex(sched.games),
    teams: sched.teams,
    season: sched.season,
    scheduleFetchedAt: sched.fetchedAt,
    playersFetchedAt: players.fetchedAt,
    eligibilityDetail: players.sources.eligibility.detail,
    players: players.players,
    warnings: [...sv.warnings, ...pv.warnings],
  };
}

export async function loadDataset(base = import.meta.env.BASE_URL): Promise<Dataset> {
  const [s, p] = await Promise.all([getJson(`${base}data/schedule.json`), getJson(`${base}data/players.json`)]);
  return buildDataset(s, p);
}

export function isStale(data: Dataset, now = Date.now()): boolean {
  const t = Date.parse(data.scheduleFetchedAt);
  return Number.isNaN(t) || now - t > STALE_AFTER_MS;
}

/**
 * Resolve saved player ids. Ids can change when a player gains an NHL match
 * (espn-123 → nhl-456), so ids are also looked up by their source id.
 */
export function buildPlayerLookup(players: readonly Player[], custom: readonly Player[]) {
  const byId = new Map<string, Player>();
  const alias = new Map<string, Player>();
  for (const p of [...players, ...custom]) {
    byId.set(p.id, p);
    if (p.nhlId !== undefined) alias.set(`nhl-${p.nhlId}`, p);
    if (p.espnId !== undefined) alias.set(`espn-${p.espnId}`, p);
  }
  return {
    byId,
    resolve(id: string): Player | undefined {
      return byId.get(id) ?? alias.get(id);
    },
  };
}
