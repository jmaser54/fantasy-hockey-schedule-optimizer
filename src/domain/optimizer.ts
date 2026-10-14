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

/** A manual lineup for one date: seat key → player id. */
export type ManualLineup = Record<string, string>;

export type UnusedReason =
  | { kind: 'ir' }
  | { kind: 'no-slot'; positions: Position[] }
  | { kind: 'slots-full'; slotLabels: string[]; occupants: string[] }
  | { kind: 'benched' };

export interface DayPlayerStatus {
  playerId: string;
  game?: Game;
  team: TeamId;
  seatKey?: string;
  /** Set when the player had a game but it was not usable. */
  reason?: UnusedReason;
}

export interface DayResult {
  date: ISODate;
  seats: { seat: Seat; playerId?: string }[];
  players: DayPlayerStatus[];
  /** Non-IR roster players with a game this date. */
  scheduled: number;
  usable: number;
  goalieUsable: number;
  /** Max achievable on this date (equals usable when not manual). */
  optimalUsable: number;
  manual: boolean;
  /** Manual placements that were invalid and ignored. */
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

/** Optimal lineup for one date. Deterministic for a given roster order. */
function optimalAssignment(
  playing: readonly LineupPlayer[],
  seats: readonly Seat[],
): (number | -1)[] {
  const adjacency = playing.map((p) => eligibleSeatIndices(p, seats));
  return maxBipartiteMatching(playing.length, seats.length, adjacency).leftToRight;
}

export function optimizeDay(
  date: ISODate,
  roster: readonly LineupPlayer[],
  seats: readonly Seat[],
  schedule: ScheduleIndex,
  manual?: ManualLineup,
): DayResult {
  const statuses: DayPlayerStatus[] = roster.map((p) => ({
    playerId: p.id,
    team: teamOnDate(p, date),
    game: playerGameOn(schedule, p, date),
  }));
  const byId = new Map(roster.map((p) => [p.id, p]));
  const statusById = new Map(statuses.map((s) => [s.playerId, s]));

  const playing = roster.filter((p) => !p.onIr && statusById.get(p.id)!.game);
  const optimal = optimalAssignment(playing, seats);
  const optimalUsable = optimal.filter((s) => s !== -1).length;

  const seatPlayer: (string | undefined)[] = new Array(seats.length).fill(undefined);
  const manualIssues: string[] = [];
  const isManual = manual !== undefined;

  if (!isManual) {
    playing.forEach((p, i) => {
      const s = optimal[i]!;
      if (s !== -1) seatPlayer[s] = p.id;
    });
  } else {
    const seatIndex = new Map(seats.map((s, i) => [s.key, i]));
    const placed = new Set<string>();
    for (const [seatKey, playerId] of Object.entries(manual)) {
      const idx = seatIndex.get(seatKey);
      const p = byId.get(playerId);
      if (idx === undefined) {
        manualIssues.push(`Slot ${seatKey} no longer exists.`);
        continue;
      }
      if (!p) {
        manualIssues.push('A player in this lineup is no longer on the roster.');
        continue;
      }
      if (p.onIr) {
        manualIssues.push(`${p.name} is on IR.`);
        continue;
      }
      if (!p.positions.some((pos) => seats[idx]!.accepts.includes(pos))) {
        manualIssues.push(`${p.name} is not eligible for ${seats[idx]!.label}.`);
        continue;
      }
      if (placed.has(playerId)) {
        manualIssues.push(`${p.name} is in two slots.`);
        continue;
      }
      placed.add(playerId);
      seatPlayer[idx] = playerId;
    }
  }

  // Players who sit in a seat (with or without a game, manual lineups may
  // start a player who has no game).
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

  // Explain every scheduled game that is not usable.
  for (const p of roster) {
    const st = statusById.get(p.id)!;
    if (!st.game || st.seatKey) continue;
    if (p.onIr) {
      st.reason = { kind: 'ir' };
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
  manualByDate: Record<ISODate, ManualLineup> = {},
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
  manualByDate: Record<ISODate, ManualLineup> = {},
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

/** Seed for a manual edit: the lineup currently shown for that day. */
export function lineupFromDay(day: DayResult): ManualLineup {
  const out: ManualLineup = {};
  for (const { seat, playerId } of day.seats) if (playerId) out[seat.key] = playerId;
  return out;
}

/**
 * Move a player into a seat in a manual lineup. Whoever held the seat goes to
 * the bench; if the player was in another seat that seat becomes empty
 * (or receives the displaced player when they are eligible for it — a swap).
 */
export function moveInLineup(
  lineup: ManualLineup,
  playerId: string,
  targetSeat: Seat | null,
  seats: readonly Seat[],
  roster: readonly LineupPlayer[],
): ManualLineup {
  const next: ManualLineup = { ...lineup };
  const fromKey = Object.keys(next).find((k) => next[k] === playerId);
  if (fromKey) delete next[fromKey];
  if (!targetSeat) return next;
  const displaced = next[targetSeat.key];
  next[targetSeat.key] = playerId;
  if (displaced && fromKey) {
    const fromSeat = seats.find((s) => s.key === fromKey);
    const dp = roster.find((p) => p.id === displaced);
    if (fromSeat && dp && dp.positions.some((pos) => fromSeat.accepts.includes(pos))) next[fromKey] = displaced;
  }
  return next;
}
