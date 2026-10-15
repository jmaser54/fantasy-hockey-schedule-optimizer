/**
 * Daily lineup optimization for usable player-games.
 *
 * Model (and its assumptions):
 * - Lineups are set independently for each calendar date. Moving players
 *   between bench and active slots costs nothing and has no weekly lock.
 * - A non-IR rostered player whose NHL team plays on a date can fill at most
 *   one active slot that accepts one of the player's eligible positions.
 * - A usable player-game = a player with a game on that date placed in an
 *   active slot. Bench players and IR players produce no usable games.
 * - Each player-game has equal value, so the best lineup for a date is a
 *   maximum-cardinality bipartite matching between playing players and slot
 *   seats. Because days are independent, summing daily maxima gives the
 *   maximum for any period.
 * - Goalie games are opportunities (the team plays), not confirmed starts.
 * - No games-played caps or acquisition limits are modeled.
 *
 * Priorities and daily choices:
 * - Players are offered seats in priority order (Preferred first, then roster
 *   order). Kuhn's algorithm never unmatches a matched player, so this is the
 *   greedy algorithm on the transversal matroid of playing players: the lineup
 *   still fills the maximum number of seats, and among all such lineups it
 *   seats as many Preferred players as possible (ties by roster order).
 * - A date can carry the user's choices: players to start and players to sit.
 *   Starts are placed first, sits are left out, and the remaining seats are
 *   filled automatically in priority order. Choices that can't be honored
 *   (IR, no game, no room) are ignored and reported, never forced through.
 */
import { eachDate } from './dates.ts';
import { maxBipartiteMatching } from './matching.ts';
import { playerGameOn, teamOnDate, type ScheduleIndex } from './schedule.ts';
import type { Game, ISODate, LeagueConfig, LineupSlot, Position, TeamId, TeamStint } from './types.ts';

export interface LineupPlayer {
  id: string;
  name: string;
  team: TeamId;
  stints?: TeamStint[];
  /** Effective fantasy eligibility (overrides already applied). */
  positions: Position[];
  onIr: boolean;
  /** Gets lineup spots first when players compete for them. */
  preferred?: boolean;
}

export interface Seat {
  key: string;
  slotId: string;
  label: string;
  accepts: Position[];
}

export function expandSeats(slots: readonly LineupSlot[]): Seat[] {
  const seats: Seat[] = [];
  for (const s of slots) {
    for (let i = 0; i < s.count; i++) {
      seats.push({ key: `${s.id}#${i}`, slotId: s.id, label: s.label, accepts: s.accepts });
    }
  }
  return seats;
}

/** The user's choices for one date. Everything else is filled automatically. */
export interface DayOverride {
  /** Players the user put in the lineup. */
  start: string[];
  /** Players the user took out of the lineup. */
  sit: string[];
}

export const isEmptyOverride = (o: DayOverride | undefined) => !o || (o.start.length === 0 && o.sit.length === 0);

/** Put a player in the lineup for a date (undoes a sit). */
export function startPlayer(o: DayOverride | undefined, id: string): DayOverride {
  return { start: [...(o?.start ?? []).filter((x) => x !== id), id], sit: (o?.sit ?? []).filter((x) => x !== id) };
}

/** Take a player out of the lineup for a date (undoes a start). */
export function sitPlayer(o: DayOverride | undefined, id: string): DayOverride {
  return { start: (o?.start ?? []).filter((x) => x !== id), sit: [...(o?.sit ?? []).filter((x) => x !== id), id] };
}

export type UnusedReason =
  | { kind: 'ir' }
  | { kind: 'no-slot'; positions: Position[] }
  | { kind: 'slots-full'; slotLabels: string[]; occupants: string[] }
  | { kind: 'benched' }
  | { kind: 'sat' };

export interface DayPlayerStatus {
  playerId: string;
  game?: Game;
  team: TeamId;
  seatKey?: string;
  /** Set when the player had a game but is not in the lineup. */
  reason?: UnusedReason;
  /** The user chose to start (true) or sit (false) this player on this date. */
  choice?: 'start' | 'sit';
}

export interface DayResult {
  date: ISODate;
  seats: { seat: Seat; playerId?: string }[];
  players: DayPlayerStatus[];
  /** Non-IR roster players with a game this date. */
  scheduled: number;
  usable: number;
  goalieUsable: number;
  /** Max achievable on this date with no daily choices (equals usable when not manual). */
  optimalUsable: number;
  /** The date has user choices (starts or sits). */
  manual: boolean;
  /** User choices that could not be honored and were ignored. */
  manualIssues: string[];
}

/** The player fills this seat as a goalie (the seat takes G and no other position of theirs). */
function playsAsGoalie(p: LineupPlayer, seat: Seat): boolean {
  if (!p.positions.includes('G') || !seat.accepts.includes('G')) return false;
  return !p.positions.some((pos) => pos !== 'G' && seat.accepts.includes(pos));
}

function eligibleSeatIndices(p: LineupPlayer, seats: readonly Seat[]): number[] {
  const out: number[] = [];
  seats.forEach((s, i) => {
    if (p.positions.some((pos) => s.accepts.includes(pos))) out.push(i);
  });
  return out;
}

/** Preferred players first, otherwise roster order (stable). */
export function priorityOrder<T extends Pick<LineupPlayer, 'preferred'>>(players: readonly T[]): T[] {
  return [...players].sort((x, y) => Number(!!y.preferred) - Number(!!x.preferred));
}

/** Greedy max matching in the given order: earlier players get seats first, without losing total seats. */
function assignInOrder(ordered: readonly LineupPlayer[], seats: readonly Seat[]): (number | -1)[] {
  const adjacency = ordered.map((p) => eligibleSeatIndices(p, seats));
  return maxBipartiteMatching(ordered.length, seats.length, adjacency).leftToRight;
}

/** Whether all of these players can be in the lineup together. */
export function canStartTogether(players: readonly LineupPlayer[], seats: readonly Seat[]): boolean {
  return assignInOrder(players, seats).every((s) => s !== -1);
}

export function optimizeDay(
  date: ISODate,
  roster: readonly LineupPlayer[],
  seats: readonly Seat[],
  schedule: ScheduleIndex,
  override?: DayOverride,
): DayResult {
  const statuses: DayPlayerStatus[] = roster.map((p) => ({
    playerId: p.id,
    team: teamOnDate(p, date),
    game: playerGameOn(schedule, p, date),
  }));
  const byId = new Map(roster.map((p) => [p.id, p]));
  const statusById = new Map(statuses.map((s) => [s.playerId, s]));

  const playing = priorityOrder(roster.filter((p) => !p.onIr && statusById.get(p.id)!.game));
  const optimalUsable = assignInOrder(playing, seats).filter((s) => s !== -1).length;

  const manualIssues: string[] = [];
  const isManual = !isEmptyOverride(override);
  const started = new Set<string>();
  const sat = new Set(override?.sit ?? []);
  for (const id of override?.start ?? []) {
    const p = byId.get(id);
    if (!p) manualIssues.push('A player you chose to start is no longer on the roster.');
    else if (p.onIr) manualIssues.push(`${p.name} is on IR, so they can’t start.`);
    else if (!statusById.get(id)!.game) manualIssues.push(`${p.name} has no game on this date.`);
    else started.add(id);
  }
  for (const id of sat) if (statusById.has(id)) statusById.get(id)!.choice = 'sit';

  // Starts first (in priority order), then everyone else not sat, in priority order.
  const startOrder = playing.filter((p) => started.has(p.id));
  const ordered = [...startOrder, ...playing.filter((p) => !started.has(p.id) && !sat.has(p.id))];
  const assignment = assignInOrder(ordered, seats);
  const seatPlayer: (string | undefined)[] = new Array(seats.length).fill(undefined);
  ordered.forEach((p, i) => {
    const s = assignment[i]!;
    if (s !== -1) seatPlayer[s] = p.id;
    else if (started.has(p.id)) manualIssues.push(`${p.name} couldn’t be started: every slot they fit holds another player you chose to start.`);
  });
  for (const p of startOrder) if (assignment[ordered.indexOf(p)] !== -1) statusById.get(p.id)!.choice = 'start';

  seats.forEach((_, i) => {
    const pid = seatPlayer[i];
    if (pid) statusById.get(pid)!.seatKey = seats[i]!.key;
  });

  let usable = 0;
  let goalieUsable = 0;
  seats.forEach((seat, i) => {
    const pid = seatPlayer[i];
    if (!pid) return;
    if (statusById.get(pid)!.game) {
      usable++;
      if (playsAsGoalie(byId.get(pid)!, seat)) goalieUsable++;
    }
  });

  // Explain every scheduled game that is not in the lineup.
  for (const p of roster) {
    const st = statusById.get(p.id)!;
    if (!st.game || st.seatKey) continue;
    if (p.onIr) {
      st.reason = { kind: 'ir' };
      continue;
    }
    if (sat.has(p.id)) {
      st.reason = { kind: 'sat' };
      continue;
    }
    const eligible = eligibleSeatIndices(p, seats);
    if (eligible.length === 0) {
      st.reason = { kind: 'no-slot', positions: p.positions };
      continue;
    }
    const allFull = eligible.every((i) => seatPlayer[i] && statusById.get(seatPlayer[i]!)!.game);
    if (allFull) {
      st.reason = {
        kind: 'slots-full',
        slotLabels: [...new Set(eligible.map((i) => seats[i]!.label))],
        occupants: [...new Set(eligible.map((i) => byId.get(seatPlayer[i]!)!.name))],
      };
    } else {
      st.reason = { kind: 'benched' };
    }
  }

  return {
    date,
    seats: seats.map((seat, i) => ({ seat, playerId: seatPlayer[i] })),
    players: statuses,
    scheduled: playing.length,
    usable,
    goalieUsable,
    optimalUsable,
    manual: isManual,
    manualIssues,
  };
}

export interface PlayerTotals {
  playerId: string;
  /** NHL games the player's team(s) play in the range. */
  scheduled: number;
  /** Games the player is in the final daily lineup (daily choices included). */
  usable: number;
}

export interface RangeResult {
  start: ISODate;
  end: ISODate;
  days: DayResult[];
  scheduled: number;
  usable: number;
  goalieUsable: number;
  optimalUsable: number;
  manualDays: number;
  players: PlayerTotals[];
}

export function optimizeRange(
  start: ISODate,
  end: ISODate,
  roster: readonly LineupPlayer[],
  league: Pick<LeagueConfig, 'slots'>,
  schedule: ScheduleIndex,
  manualByDate: Record<ISODate, DayOverride> = {},
): RangeResult {
  const seats = expandSeats(league.slots);
  const days = eachDate(start, end).map((d) => optimizeDay(d, roster, seats, schedule, manualByDate[d]));
  return summarize(days, roster, start, end);
}

/** Optimize a set of dates (each once), e.g. the union of all playoff rounds. */
export function optimizeDates(
  dates: Iterable<ISODate>,
  roster: readonly LineupPlayer[],
  league: Pick<LeagueConfig, 'slots'>,
  schedule: ScheduleIndex,
  manualByDate: Record<ISODate, DayOverride> = {},
): Map<ISODate, DayResult> {
  const seats = expandSeats(league.slots);
  const out = new Map<ISODate, DayResult>();
  for (const d of dates) if (!out.has(d)) out.set(d, optimizeDay(d, roster, seats, schedule, manualByDate[d]));
  return out;
}

/** Aggregate daily results. Each date contributes once. */
export function summarize(days: readonly DayResult[], roster: readonly LineupPlayer[], start: ISODate, end: ISODate): RangeResult {
  const totals = new Map<string, PlayerTotals>(roster.map((p) => [p.id, { playerId: p.id, scheduled: 0, usable: 0 }]));
  for (const day of days) {
    for (const st of day.players) {
      if (!st.game) continue;
      const t = totals.get(st.playerId);
      if (!t) continue;
      t.scheduled++;
      if (st.seatKey) t.usable++;
    }
  }
  return {
    start,
    end,
    days: [...days],
    scheduled: days.reduce((n, d) => n + d.scheduled, 0),
    usable: days.reduce((n, d) => n + d.usable, 0),
    goalieUsable: days.reduce((n, d) => n + d.goalieUsable, 0),
    optimalUsable: days.reduce((n, d) => n + d.optimalUsable, 0),
    manualDays: days.filter((d) => d.manual).length,
    players: [...totals.values()],
  };
}
