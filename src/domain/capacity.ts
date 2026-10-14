/**
 * Informational daily counts for the lineup grid: rostered player-game
 * opportunities vs active lineup capacity, split into skaters and goalies.
 * Read-only; this does not affect optimization or assignments.
 */
import type { DayResult, LineupPlayer } from './optimizer.ts';
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

/** Sum daily counts over a set of days (e.g. a playoff round): total opportunities vs total slot-days. */
export function sumGroupCounts(days: readonly DayResult[], roster: readonly LineupPlayer[], slots: readonly LineupSlot[]): DailyGroupCounts {
  const total: DailyGroupCounts = { skaters: { available: 0, capacity: 0 }, goalies: { available: 0, capacity: 0 } };
  for (const day of days) {
    const c = dailyGroupCounts(day, roster, slots);
    total.skaters.available += c.skaters.available;
    total.skaters.capacity += c.skaters.capacity;
    total.goalies.available += c.goalies.available;
    total.goalies.capacity += c.goalies.capacity;
  }
  return total;
}
