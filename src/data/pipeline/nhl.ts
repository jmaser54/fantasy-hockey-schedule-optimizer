/**
 * Parsers for the NHL web API (api-web.nhle.com/v1). The API is undocumented,
 * so every field we rely on is checked and anything unexpected throws with a
 * specific message rather than producing partial data.
 */
import { easternDateFromUTC, isValidISODate } from '../../domain/dates.ts';
import type { Game, Position, Team } from '../../domain/types.ts';

export const NHL_BASE = 'https://api-web.nhle.com/v1';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function localized(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (isObj(v) && typeof v.default === 'string') return v.default;
  return undefined;
}

function req<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`NHL API: missing ${what}`);
  return value;
}

/** /standings/now → team list. */
export function parseStandingsTeams(body: unknown): Team[] {
  if (!isObj(body) || !Array.isArray(body.standings)) throw new Error('NHL API: standings response has no "standings" array');
  return body.standings.map((row, i) => {
    if (!isObj(row)) throw new Error(`NHL API: standings row ${i} is not an object`);
    return {
      id: req(localized(row.teamAbbrev), `standings[${i}].teamAbbrev`),
      name: req(localized(row.teamName), `standings[${i}].teamName`),
    };
  });
}

export const GAME_TYPE_REGULAR = 2;
/** Schedule states that mean the game will not be played on its listed date. */
const NOT_PLAYED_STATES = new Set(['PPD', 'CNCL', 'SUSP']);

export interface ParsedClubSchedule {
  games: Game[];
  skipped: { id: string; reason: string }[];
}

/** /club-schedule-season/{TEAM}/{season} → that team's regular-season games. */
export function parseClubSchedule(body: unknown, season: string): ParsedClubSchedule {
  if (!isObj(body) || !Array.isArray(body.games)) throw new Error('NHL API: club schedule response has no "games" array');
  const games: Game[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const [i, g] of body.games.entries()) {
    if (!isObj(g)) throw new Error(`NHL API: games[${i}] is not an object`);
    const id = String(req(g.id as number | undefined, `games[${i}].id`));
    if (g.gameType !== GAME_TYPE_REGULAR) continue;
    if (String(g.season) !== season) {
      skipped.push({ id, reason: `season ${String(g.season)}` });
      continue;
    }
    const state = typeof g.gameScheduleState === 'string' ? g.gameScheduleState : 'OK';
    if (NOT_PLAYED_STATES.has(state)) {
      skipped.push({ id, reason: `schedule state ${state}` });
      continue;
    }
    let date = typeof g.gameDate === 'string' ? g.gameDate : undefined;
    if (!date && typeof g.startTimeUTC === 'string' && typeof g.easternUTCOffset === 'string') {
      date = easternDateFromUTC(g.startTimeUTC, g.easternUTCOffset);
    }
    if (!isValidISODate(date)) throw new Error(`NHL API: game ${id} has no valid date`);
    const home = isObj(g.homeTeam) ? localized(g.homeTeam.abbrev) : undefined;
    const away = isObj(g.awayTeam) ? localized(g.awayTeam.abbrev) : undefined;
    games.push({ id, date, home: req(home, `game ${id} homeTeam.abbrev`), away: req(away, `game ${id} awayTeam.abbrev`) });
  }
  return { games, skipped };
}

/**
 * Merge per-team schedules. Every game must appear in both teams' lists with
 * identical details; mismatches are returned as errors.
 */
export function mergeClubSchedules(byTeam: ReadonlyMap<string, Game[]>): { games: Game[]; errors: string[] } {
  const merged = new Map<string, { game: Game; seenBy: Set<string> }>();
  const errors: string[] = [];
  for (const [team, games] of byTeam) {
    for (const g of games) {
      if (g.home !== team && g.away !== team) errors.push(`${team} schedule lists game ${g.id} it doesn't play in`);
      const existing = merged.get(g.id);
      if (!existing) {
        merged.set(g.id, { game: g, seenBy: new Set([team]) });
        continue;
      }
      const e = existing.game;
      if (e.date !== g.date || e.home !== g.home || e.away !== g.away) {
        errors.push(`Game ${g.id} differs between team schedules (${e.date} ${e.away}@${e.home} vs ${g.date} ${g.away}@${g.home})`);
      }
      existing.seenBy.add(team);
    }
  }
  for (const { game, seenBy } of merged.values()) {
    for (const t of [game.home, game.away]) {
      if (byTeam.has(t) && !seenBy.has(t)) errors.push(`Game ${game.id} missing from ${t}'s schedule`);
    }
  }
  const games = [...merged.values()].map((m) => m.game).sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));
  return { games, errors };
}

export interface NhlRosterPlayer {
  nhlId: number;
  name: string;
  team: string;
  positionCode: 'C' | 'L' | 'R' | 'D' | 'G';
}

const POSITION_CODES = new Set(['C', 'L', 'R', 'D', 'G']);

/** /roster/{TEAM}/current → players. */
export function parseRoster(body: unknown, team: string): NhlRosterPlayer[] {
  if (!isObj(body)) throw new Error(`NHL API: roster for ${team} is not an object`);
  const out: NhlRosterPlayer[] = [];
  for (const group of ['forwards', 'defensemen', 'goalies'] as const) {
    const list = body[group];
    if (!Array.isArray(list)) throw new Error(`NHL API: roster for ${team} has no "${group}" array`);
    for (const p of list) {
      if (!isObj(p) || typeof p.id !== 'number') throw new Error(`NHL API: malformed ${group} entry for ${team}`);
      const first = req(localized(p.firstName), `player ${p.id} firstName`);
      const last = req(localized(p.lastName), `player ${p.id} lastName`);
      const pos = p.positionCode;
      if (typeof pos !== 'string' || !POSITION_CODES.has(pos)) throw new Error(`NHL API: player ${p.id} has position ${String(pos)}`);
      out.push({ nhlId: p.id, name: `${first} ${last}`, team, positionCode: pos as NhlRosterPlayer['positionCode'] });
    }
  }
  return out;
}

export const NHL_POSITION_TO_FANTASY: Record<NhlRosterPlayer['positionCode'], Position> = {
  C: 'C',
  L: 'LW',
  R: 'RW',
  D: 'D',
  G: 'G',
};
