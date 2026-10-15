/**
 * Informational daily counts for the lineup grid: rostered player-game
 * opportunities vs active lineup capacity, split into skaters and goalies.
 * Read-only; this does not affect optimization or assignments.
 */
import type { DayResult, LineupPlayer, PlayerTotals } from './optimizer.ts';
import type { LineupSlot, Position } from './types.ts';

const SKATER_POSITIONS: readonly Position[] = ['C', 'LW', 'RW', 'D'];

export interface GroupCount {
  /** Non-IR rostered players in the group with a game that day (each player once). */
  available: number;
  /** Active lineup seats that can hold a player from the group. */
  capacity: number;
}

export interface DailyGroupCounts {
  skaters: GroupCount;
  goalies: GroupCount;
}

const isSkater = (positions: readonly Position[]) => positions.some((p) => SKATER_POSITIONS.includes(p));
const isGoalie = (positions: readonly Position[]) => positions.includes('G');

/**
 * Active seats per group, from the configured slots. A slot counts toward
 * every group it can hold (a custom slot accepting both skaters and goalies
 * counts toward both; the defaults have no such slot).
 */
export function groupCapacity(slots: readonly LineupSlot[]): { skaters: number; goalies: number } {
  let skaters = 0;
  let goalies = 0;
  for (const s of slots) {
    if (isSkater(s.accepts)) skaters += s.count;
    if (isGoalie(s.accepts)) goalies += s.count;
  }
  return { skaters, goalies };
}

export function dailyGroupCounts(day: DayResult, roster: readonly LineupPlayer[], slots: readonly LineupSlot[]): DailyGroupCounts {
  const byId = new Map(roster.map((p) => [p.id, p]));
  let skaters = 0;
  let goalies = 0;
  for (const st of day.players) {
    if (!st.game) continue;
    const p = byId.get(st.playerId);
    if (!p || p.onIr) continue;
    if (isSkater(p.positions)) skaters++;
    if (isGoalie(p.positions)) goalies++;
  }
  const cap = groupCapacity(slots);
  return { skaters: { available: skaters, capacity: cap.skaters }, goalies: { available: goalies, capacity: cap.goalies } };
}

/** In-lineup and scheduled player games for one group of rows. */
export interface LineupTotal {
  /** Player-games assigned a lineup seat by the daily lineups. */
  inLineup: number;
  /** Player-games scheduled for the same players (one per player per game). */
  scheduled: number;
}

/** Same grouping as the lineup grid: a player is a goalie only if every listed position is G. */
export const isGoalieOnly = (p: LineupPlayer) => p.positions.length > 0 && p.positions.every((x) => x === 'G');

/**
 * Period summary by group, built from the per-player In Lineup / Scheduled
 * totals so it always equals the sum of the grid rows. Players on IR can't be
 * in a lineup and are left out of both groups, matching the grid's Skaters and
 * Goalies sections and the daily "In Lineup / Your Games" counts.
 */
export function lineupGroupTotals(
  totals: readonly PlayerTotals[],
  roster: readonly LineupPlayer[],
): { skaters: LineupTotal; goalies: LineupTotal; all: LineupTotal } {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const out = { skaters: { inLineup: 0, scheduled: 0 }, goalies: { inLineup: 0, scheduled: 0 }, all: { inLineup: 0, scheduled: 0 } };
  for (const t of totals) {
    const p = byId.get(t.playerId);
    if (!p || p.onIr) continue;
    for (const g of [isGoalieOnly(p) ? out.goalies : out.skaters, out.all]) {
      g.inLineup += t.usable;
      g.scheduled += t.scheduled;
    }
  }
  return out;
}
