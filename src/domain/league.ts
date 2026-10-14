import { isValidISODate } from './dates.ts';
import { POSITIONS, type LeagueConfig, type LineupSlot, type Period, type Position } from './types.ts';

export const DEFAULT_SLOTS: LineupSlot[] = [
  { id: 'C', label: 'C', count: 2, accepts: ['C'] },
  { id: 'LW', label: 'LW', count: 2, accepts: ['LW'] },
  { id: 'RW', label: 'RW', count: 2, accepts: ['RW'] },
  { id: 'D', label: 'D', count: 4, accepts: ['D'] },
  { id: 'UTIL', label: 'UTIL', count: 1, accepts: ['C', 'LW', 'RW', 'D'] },
  { id: 'G', label: 'G', count: 2, accepts: ['G'] },
];

export const DEFAULT_LEAGUE: LeagueConfig = {
  rosterSize: 22,
  irSlots: 2,
  irEligibility: 'injured',
  slots: DEFAULT_SLOTS,
};

export const DEFAULT_PERIODS: Period[] = [
  { id: 'r1', name: 'Round 1', start: '2027-02-22', end: '2027-03-07' },
  { id: 'r2', name: 'Round 2', start: '2027-03-08', end: '2027-03-21' },
  { id: 'r3', name: 'Round 3', start: '2027-03-22', end: '2027-04-04' },
];

export function activeSlotCount(league: LeagueConfig): number {
  return league.slots.reduce((n, s) => n + s.count, 0);
}

/** Problems that make a league config unusable. Empty array = valid. */
export function validateLeague(league: LeagueConfig): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(league.rosterSize) || league.rosterSize < 1) errors.push('Roster size must be at least 1.');
  if (!Number.isInteger(league.irSlots) || league.irSlots < 0) errors.push('IR slots cannot be negative.');
  const ids = new Set<string>();
  for (const s of league.slots) {
    if (!s.label.trim()) errors.push('Every lineup slot needs a name.');
    if (ids.has(s.id)) errors.push(`Duplicate slot id ${s.id}.`);
    ids.add(s.id);
    if (!Number.isInteger(s.count) || s.count < 0) errors.push(`${s.label}: count must be 0 or more.`);
    if (s.count > 0 && s.accepts.length === 0) errors.push(`${s.label}: accepts no positions.`);
    if (s.accepts.some((p) => !POSITIONS.includes(p))) errors.push(`${s.label}: unknown position.`);
  }
  if (activeSlotCount(league) > league.rosterSize) {
    errors.push('Active lineup slots exceed roster size.');
  }
  return errors;
}

export function validatePeriod(p: Period): string | null {
  if (!isValidISODate(p.start) || !isValidISODate(p.end)) return 'Enter valid dates.';
  if (p.end < p.start) return 'End date is before start date.';
  return null;
}

export function slotAccepts(slot: LineupSlot, positions: readonly Position[]): boolean {
  return positions.some((p) => slot.accepts.includes(p));
}
