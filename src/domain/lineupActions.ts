/**
 * Lineup actions for the week grid (Lineup UX redesign, 2026-11-22). Pure helpers on top of the
 * existing optimizer: the automatic lineup (`optimizeDay` with no override) stays the baseline, and
 * manual changes are saved per date as exact lineups (`DayOverride.lineup`), as the day editor did.
 * Nothing here invents a new optimization: seats are filled with the same Kuhn matching
 * (`maxBipartiteMatching`) in the same priority order (`priorityOrder`).
 */
import { maxBipartiteMatching } from './matching.ts';
import { canPlaySeat, moveInLineup, optimizeDay, priorityOrder, type DayOverride, type DayResult, type LineupPlayer, type Seat } from './optimizer.ts';
import type { ScheduleIndex } from './schedule.ts';
import type { Game, ISODate } from './types.ts';

/** Seat key → player id, or null for an empty seat. */
export type Lineup = Record<string, string | null>;

export const lineupOf = (day: DayResult): Lineup => Object.fromEntries(day.seats.map((x) => [x.seat.key, x.playerId ?? null]));

/** Players with a game on the day (IR or not), by id. */
const gamesOf = (day: DayResult): Map<string, Game> => new Map(day.players.flatMap((s) => (s.game ? [[s.playerId, s.game] as const] : [])));

/**
 * The override to save for one date's new exact lineup, as the day editor saved it: null when the
 * lineup equals the automatic one (the day goes back to optimized). Carried "no longer applies"
 * notes are kept. Only this date is affected.
 */
export function overrideFor(
  date: ISODate,
  next: Lineup,
  roster: readonly LineupPlayer[],
  seats: readonly Seat[],
  schedule: ScheduleIndex,
  notes?: string[],
): DayOverride | null {
  const auto = optimizeDay(date, roster, seats, schedule);
  if (auto.seats.every((x) => (x.playerId ?? null) === (next[x.seat.key] ?? null))) return null;
  return { start: Object.values(next).filter((x): x is string => !!x), sit: [], lineup: next, ...(notes?.length ? { notes } : {}) };
}

// ---------------------------------------------------------------------------
// What a game that is not in the lineup means

/**
 * - `in-lineup`: the player is in an active slot.
 * - `ir`: the player is on IR.
 * - `opportunity`: the game could be added without giving up another game (an open slot, a slot held
 *   by a player without a game, or a rearrangement of the current starters). Only manually changed
 *   days can have these: the automatic lineup is already a maximum (§D.1).
 * - `priority`: every way in costs another game; the lineup (automatic or yours) chose other players.
 * - `constraint`: no lineup slot accepts the player's positions.
 */
export type GameKind = 'in-lineup' | 'ir' | 'opportunity' | 'priority' | 'constraint';

/** Seat assignment for `ids` (all must be seated) that keeps each player's current seat where possible; null if impossible. */
function seatAll(ids: readonly string[], lineup: Lineup, seats: readonly Seat[], players: ReadonlyMap<string, LineupPlayer>): Lineup | null {
  const current = new Map(Object.entries(lineup).flatMap(([k, id]) => (id ? [[id, k] as const] : [])));
  const adjacency = ids.map((id) => {
    const p = players.get(id)!;
    const ok = seats.flatMap((s, i) => (canPlaySeat(p, s) ? [i] : []));
    const mine = seats.findIndex((s) => s.key === current.get(id));
    return mine >= 0 && ok.includes(mine) ? [mine, ...ok.filter((i) => i !== mine)] : ok;
  });
  const m = maxBipartiteMatching(ids.length, seats.length, adjacency);
  if (m.size < ids.length) return null;
  const out: Lineup = Object.fromEntries(seats.map((s) => [s.key, null]));
  m.leftToRight.forEach((si, i) => (out[seats[si]!.key] = ids[i]!));
  return out;
}

export function gameKind(day: DayResult, playerId: string, players: ReadonlyMap<string, LineupPlayer>, seats: readonly Seat[]): GameKind | undefined {
  const st = day.players.find((x) => x.playerId === playerId);
  const p = players.get(playerId);
  if (!st?.game || !p) return undefined;
  if (st.seatKey) return 'in-lineup';
  if (p.onIr) return 'ir';
  if (!seats.some((s) => canPlaySeat(p, s))) return 'constraint';
  const games = gamesOf(day);
  const lineup = lineupOf(day);
  const keep = Object.values(lineup).filter((id): id is string => !!id && games.has(id));
  return seatAll([...keep, playerId], lineup, seats, players) ? 'opportunity' : 'priority';
}

/** Would the automatic lineup include this game? (Tells "your changes left this out" from a plain open slot.) */
export function inAutomaticLineup(date: ISODate, playerId: string, roster: readonly LineupPlayer[], seats: readonly Seat[], schedule: ScheduleIndex): boolean {
  return optimizeDay(date, roster, seats, schedule).players.some((x) => x.playerId === playerId && !!x.seatKey);
}

// ---------------------------------------------------------------------------
// Options for a game cell

export interface AddOption {
  /** `open`: gains a game and gives none up. `replace`: gains this game, gives up `lose`. */
  kind: 'open' | 'replace';
  seatKey: string;
  seatLabel: string;
  /** The player who leaves the lineup (may have no game). */
  outId?: string;
  gain: Game;
  /** The game given up (replace only). */
  lose?: Game;
  /** The lowest-priority player to replace: the first suggestion. */
  suggested?: boolean;
  next: Lineup;
}

/**
 * Ways to put a player's game into the day's lineup. Open spots first (empty seats before seats held
 * by players without a game). If none is direct but the current starters can be rearranged, one open
 * option moves them (`seatKey` is the player's new seat). Then replacements: one per player with a
 * game who could make room, lowest priority first (reverse `priorityOrder`), the first marked suggested.
 */
export function addOptions(day: DayResult, playerId: string, roster: readonly LineupPlayer[], seats: readonly Seat[]): AddOption[] {
  const players = new Map(roster.map((p) => [p.id, p]));
  const p = players.get(playerId);
  const games = gamesOf(day);
  const gain = games.get(playerId);
  if (!p || !gain || p.onIr || day.players.find((x) => x.playerId === playerId)?.seatKey) return [];
  const lineup = lineupOf(day);
  const label = (k: string) => seats.find((s) => s.key === k)!.label;
  const open: AddOption[] = [];
  const replace: AddOption[] = [];
  for (const seat of seats) {
    if (!canPlaySeat(p, seat)) continue;
    const occupant = lineup[seat.key] ?? undefined;
    const next = moveInLineup(lineup, seats, players, playerId, seat.key, occupant);
    if (!next) continue;
    if (!occupant || !games.has(occupant)) open.push({ kind: 'open', seatKey: seat.key, seatLabel: seat.label, outId: occupant, gain, next });
    else if (!replace.some((r) => r.outId === occupant)) replace.push({ kind: 'replace', seatKey: seat.key, seatLabel: seat.label, outId: occupant, gain, lose: games.get(occupant)!, next });
  }
  open.sort((a, b) => Number(!!a.outId) - Number(!!b.outId));
  if (open.length === 0) {
    const keep = Object.values(lineup).filter((id): id is string => !!id && games.has(id));
    const seated = seatAll([...keep, playerId], lineup, seats, players);
    if (seated) {
      const key = Object.keys(seated).find((k) => seated[k] === playerId)!;
      open.push({ kind: 'open', seatKey: key, seatLabel: label(key), gain, next: seated });
    }
  }
  // Lowest priority first: not preferred before preferred, later roster order before earlier.
  const rank = new Map(priorityOrder(roster).map((x, i) => [x.id, i]));
  replace.sort((a, b) => rank.get(b.outId!)! - rank.get(a.outId!)!);
  if (replace[0]) replace[0].suggested = true;
  return [...open, ...replace];
}

export interface MoveOption {
  /** Undefined: to the bench (out of the lineup). */
  seatKey?: string;
  seatLabel: string;
  /** Who swaps with the player (takes their seat or goes to the bench). */
  withId?: string;
  next: Lineup;
}

/** For a player in the lineup: other seats they can move to (swapping with the occupant), and the bench. */
export function moveOptions(day: DayResult, playerId: string, roster: readonly LineupPlayer[], seats: readonly Seat[]): MoveOption[] {
  const players = new Map(roster.map((p) => [p.id, p]));
  const lineup = lineupOf(day);
  const from = seats.find((s) => lineup[s.key] === playerId);
  if (!from) return [];
  const out: MoveOption[] = [];
  for (const seat of seats) {
    if (seat.key === from.key) continue;
    const occupant = lineup[seat.key] ?? undefined;
    const next = moveInLineup(lineup, seats, players, playerId, seat.key, occupant);
    if (next) out.push({ seatKey: seat.key, seatLabel: seat.label, withId: occupant, next });
  }
  const bench = moveInLineup(lineup, seats, players, playerId, undefined, undefined);
  if (bench) out.push({ seatLabel: 'Bench', next: bench });
  return out;
}

// ---------------------------------------------------------------------------
// IR changes

export interface DayChange {
  date: ISODate;
  /** Players with a game who joined / left the lineup that day. */
  added: string[];
  removed: string[];
}

export interface IrPlan {
  /** New overrides for the dates that change (null clears the date's changes). */
  manual: Record<ISODate, DayOverride | null>;
  changes: DayChange[];
  before: number;
  after: number;
}

/**
 * Moving a player to or from IR is a roster-wide change, re-optimized over the selected period:
 * - Automatically optimized days follow the new roster on their own (the optimizer reruns).
 * - Days you changed keep your lineup. Going to IR, the player's seat is refilled with the best
 *   bench player with a game who can play it (priority order, same matching); nobody else moves.
 *   Coming off IR changes nothing on those days.
 * Returns the overrides to save and what changes in the lineup on each date.
 */
export function planIrChange(
  playerId: string,
  toIr: boolean,
  roster: readonly LineupPlayer[],
  dates: readonly ISODate[],
  seats: readonly Seat[],
  schedule: ScheduleIndex,
  manual: Readonly<Record<ISODate, DayOverride>>,
): IrPlan {
  const after = roster.map((p) => (p.id === playerId ? { ...p, onIr: toIr } : p));
  const next: Record<ISODate, DayOverride | null> = {};
  const changes: DayChange[] = [];
  let before = 0;
  let total = 0;
  for (const date of dates) {
    const o = manual[date];
    const old = optimizeDay(date, roster, seats, schedule, o);
    let override = o;
    if (toIr && o?.lineup) {
      const vacated = Object.keys(o.lineup).filter((k) => o.lineup![k] === playerId);
      if (vacated.length) {
        const lineup: Lineup = { ...o.lineup };
        for (const k of vacated) lineup[k] = null;
        const day = optimizeDay(date, after, seats, schedule);
        const games = gamesOf(day);
        const seatedIds = new Set(Object.values(lineup).filter(Boolean));
        const bench = priorityOrder(after.filter((p) => !p.onIr && !seatedIds.has(p.id) && games.has(p.id)));
        const open = seats.filter((s) => vacated.includes(s.key));
        // Bench players with a game first, then (2026-11-24) players without one, so the seat isn't left empty.
        const idle = priorityOrder(after.filter((p) => !p.onIr && !seatedIds.has(p.id) && !games.has(p.id)));
        const candidates = [...bench, ...idle];
        const m = maxBipartiteMatching(candidates.length, open.length, candidates.map((p) => open.flatMap((s, i) => (canPlaySeat(p, s) ? [i] : []))));
        m.leftToRight.forEach((si, i) => si >= 0 && (lineup[open[si]!.key] = candidates[i]!.id));
        const saved = overrideFor(date, lineup, after, seats, schedule, o.notes);
        next[date] = saved;
        override = saved ?? undefined;
      }
    }
    const now = optimizeDay(date, after, seats, schedule, override);
    before += old.usable;
    total += now.usable;
    const inLineup = (d: DayResult) => new Set(d.players.filter((x) => x.seatKey && x.game).map((x) => x.playerId));
    const a = inLineup(old);
    const b = inLineup(now);
    const added = [...b].filter((id) => !a.has(id));
    const removed = [...a].filter((id) => !b.has(id));
    if (added.length || removed.length) changes.push({ date, added, removed });
  }
  return { manual: next, changes, before, after: total };
}

// ---------------------------------------------------------------------------
// Replacing a starter from the bench (Lineup rebuild, 2026-11-23)

export interface ReplaceOption {
  /** The bench player who takes the starter's seat. */
  inId: string;
  seatKey: string;
  seatLabel: string;
  /** The incoming player's game (none: they add no game). */
  gain?: Game;
  /** The starter's game given up (none: the starter had no game). */
  lose?: Game;
  /** Games in the day's lineup after the swap minus before (+1, 0 or −1). */
  net: number;
  next: Lineup;
}

/**
 * One-for-one replacements for a starter: every non-IR bench player who can play the starter's seat
 * takes it and the starter goes to the bench (`moveInLineup`, nobody else moves). Works in both
 * directions, so a swap can be reversed from either player. Best first: more games, then priority.
 */
export function replaceOptions(day: DayResult, starterId: string, roster: readonly LineupPlayer[], seats: readonly Seat[]): ReplaceOption[] {
  const players = new Map(roster.map((p) => [p.id, p]));
  const lineup = lineupOf(day);
  const seat = seats.find((s) => lineup[s.key] === starterId);
  if (!seat) return [];
  const games = gamesOf(day);
  const seated = new Set(Object.values(lineup).filter(Boolean));
  const rank = new Map(priorityOrder(roster).map((p, i) => [p.id, i]));
  const out: ReplaceOption[] = [];
  for (const p of roster) {
    if (p.onIr || seated.has(p.id) || !canPlaySeat(p, seat)) continue;
    const next = moveInLineup(lineup, seats, players, p.id, seat.key, starterId);
    if (!next) continue;
    const gain = games.get(p.id);
    const lose = games.get(starterId);
    out.push({ inId: p.id, seatKey: seat.key, seatLabel: seat.label, gain, lose, net: Number(!!gain) - Number(!!lose), next });
  }
  return out.sort((a, b) => b.net - a.net || rank.get(a.inId)! - rank.get(b.inId)!);
}

// ---------------------------------------------------------------------------
// Period overview

export interface DaySummary {
  date: ISODate;
  usable: number;
  scheduled: number;
  optimal: number;
  manual: boolean;
  hasIssues: boolean;
  /** Players whose game could be added without giving up another (genuine open spots). */
  opportunities: string[];
  /** Benched non-IR players with a game who can't be added without giving up another game (`priority`/`constraint`). */
  noRoom: string[];
  /**
   * Day indicator (2026-11-26): `avoidable` (crimson) when any benched non-IR player with a game is an
   * `opportunity`; else `capacity` (light yellow) when any such player remains (`noRoom`); else null.
   * Empty slots with no eligible rostered player never set it on their own; IR players and players
   * without a game never do.
   */
  attention: DayAttention;
}

export type DayAttention = 'avoidable' | 'capacity' | null;

/** A benched player's indicator: `avoidable` for an `opportunity`, `no-room` for `priority`/`constraint`. */
export function benchStatus(day: DayResult, playerId: string, players: ReadonlyMap<string, LineupPlayer>, seats: readonly Seat[]): 'avoidable' | 'no-room' | undefined {
  const k = gameKind(day, playerId, players, seats);
  return k === 'opportunity' ? 'avoidable' : k === 'priority' || k === 'constraint' ? 'no-room' : undefined;
}

/** Per-day figures for the period overview, straight from the day results (no new optimization). */
export function summarizeDays(days: readonly DayResult[], roster: readonly LineupPlayer[], seats: readonly Seat[]): DaySummary[] {
  const players = new Map(roster.map((p) => [p.id, p]));
  return days.map((d) => {
    // Every benched player with a game, classified by the existing gameKind (IR players come back as 'ir').
    const opportunities: string[] = [];
    const noRoom: string[] = [];
    for (const x of d.players) {
      if (!x.game || x.seatKey) continue;
      const st = benchStatus(d, x.playerId, players, seats);
      if (st === 'avoidable') opportunities.push(x.playerId);
      else if (st === 'no-room') noRoom.push(x.playerId);
    }
    return {
      date: d.date,
      usable: d.usable,
      scheduled: d.scheduled,
      optimal: d.optimalUsable,
      manual: d.manual,
      hasIssues: d.manualIssues.length > 0,
      opportunities,
      noRoom,
      attention: opportunities.length ? 'avoidable' : noRoom.length ? 'capacity' : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Schedule view (2026-11-23): one player's games across the period, from the same day results

export interface ScheduleCell {
  date: ISODate;
  /** The player's NHL game that date (none: empty cell). */
  game?: Game;
  /** The game is in the current lineup (automatic or your saved lineup for that date). */
  assigned: boolean;
}

export function playerSchedule(days: readonly DayResult[], playerId: string): ScheduleCell[] {
  return days.map((d) => {
    const st = d.players.find((x) => x.playerId === playerId);
    return { date: d.date, game: st?.game, assigned: !!st?.game && !!st.seatKey };
  });
}

// ---------------------------------------------------------------------------
// Placing any bench player (2026-11-24): with or without a game

export interface PlaceOption {
  seatKey: string;
  seatLabel: string;
  /** The player who goes to the bench (none: the seat was empty). */
  outId?: string;
  /** The placed player's game (none: they add no game). */
  gain?: Game;
  /** The game given up by the player who leaves (none: they had none, or the seat was empty). */
  lose?: Game;
  /** Games in the day's lineup after minus before (+1, 0 or −1). */
  net: number;
  next: Lineup;
}

/**
 * Every seat a non-IR bench player can take (strict eligibility, `canPlaySeat`), with or without a game,
 * via `moveInLineup` (nobody else moves): empty seats first, then seats held by players without a game,
 * then by players with one. `onlySeat` limits it to one seat (filling an empty slot). Users may arrange
 * the lineup however they like, so options that add no game (or cost one) are included.
 */
export function placeOptions(day: DayResult, playerId: string, roster: readonly LineupPlayer[], seats: readonly Seat[], onlySeat?: string): PlaceOption[] {
  const players = new Map(roster.map((p) => [p.id, p]));
  const p = players.get(playerId);
  const lineup = lineupOf(day);
  if (!p || p.onIr || Object.values(lineup).includes(playerId)) return [];
  const games = gamesOf(day);
  const out: PlaceOption[] = [];
  for (const seat of seats) {
    if ((onlySeat && seat.key !== onlySeat) || !canPlaySeat(p, seat)) continue;
    const occupant = lineup[seat.key] ?? undefined;
    const next = moveInLineup(lineup, seats, players, playerId, seat.key, occupant);
    if (!next) continue;
    const gain = games.get(playerId);
    const lose = occupant ? games.get(occupant) : undefined;
    out.push({ seatKey: seat.key, seatLabel: seat.label, outId: occupant, gain, lose, net: Number(!!gain) - Number(!!lose), next });
  }
  const rank = (o: PlaceOption) => (!o.outId ? 0 : !o.lose ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Bench players who could fill one (empty) seat: players with a game first, then priority order. */
export function fillCandidates(day: DayResult, seatKey: string, roster: readonly LineupPlayer[], seats: readonly Seat[]): { playerId: string; option: PlaceOption }[] {
  const games = gamesOf(day);
  return priorityOrder(roster)
    .flatMap((p) => {
      const option = placeOptions(day, p.id, roster, seats, seatKey)[0];
      return option ? [{ playerId: p.id, option }] : [];
    })
    .sort((a, b) => Number(!games.has(a.playerId)) - Number(!games.has(b.playerId)));
}
