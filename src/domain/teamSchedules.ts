/**
 * Pure helpers for the Team Schedules page: table sorting, per-date
 * matchups, and grouping rostered players by NHL team. Presentation only;
 * nothing here affects the lineup optimizer.
 */
import { opponent, type ScheduleIndex } from './schedule.ts';
import type { ISODate, Player, Position, RosterEntry, TeamId } from './types.ts';

export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: string;
  dir: SortDir;
}

/** Text columns start A→Z; numeric columns start with the most games first. */
export function defaultDir(key: string): SortDir {
  return key === 'team' ? 'asc' : 'desc';
}

/** Clicking the active column reverses it; clicking another column selects it in its default direction. */
export function nextSort(current: SortState, key: string): SortState {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: defaultDir(key) };
}

export interface TeamRow {
  team: TeamId;
  /** Numeric values by column key. */
  values: Record<string, number>;
}

/**
 * Sort rows by the chosen column. Ties are broken the same way in either
 * direction (by the tie-break columns, most first, then team A→Z), so the
 * order is deterministic and reversing a column only reverses the column.
 */
export function sortTeamRows<T extends TeamRow>(rows: readonly T[], sort: SortState, tieBreakKeys: readonly string[] = []): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = sort.key === 'team' ? a.team.localeCompare(b.team) : (a.values[sort.key] ?? 0) - (b.values[sort.key] ?? 0);
    if (primary !== 0) return primary * sign;
    for (const k of tieBreakKeys) {
      if (k === sort.key) continue;
      const d = (b.values[k] ?? 0) - (a.values[k] ?? 0);
      if (d !== 0) return d;
    }
    return a.team.localeCompare(b.team);
  });
}

export interface Matchup {
  id: string;
  away: TeamId;
  home: TeamId;
}

/** NHL games on a date as away @ home pairs, in schedule order. */
export function matchupsOn(schedule: ScheduleIndex, date: ISODate): Matchup[] {
  return schedule.gamesOn(date).map((g) => ({ id: g.id, away: g.away, home: g.home }));
}

/** A team's game on a date as a compact cell label ("@BOS" away, "BOS" home), or null on an off-day. */
export function gridCell(schedule: ScheduleIndex, team: TeamId, date: ISODate): { label: string; home: boolean; opponent: TeamId } | null {
  const g = schedule.teamGameOn(team, date);
  if (!g) return null;
  const o = opponent(g, team);
  return { label: o.home ? o.team : `@${o.team}`, home: o.home, opponent: o.team };
}

export interface RosteredPlayer {
  id: string;
  name: string;
  positions: Position[];
  onIr: boolean;
}

/** Rostered players grouped by their current NHL team, names A→Z. Uses the roster's eligibility overrides. */
export function rosterPlayersByTeam(
  entries: readonly RosterEntry[],
  resolve: (id: string) => Player | undefined,
): Map<TeamId, RosteredPlayer[]> {
  const out = new Map<TeamId, RosteredPlayer[]>();
  for (const e of entries) {
    const p = resolve(e.playerId);
    if (!p) continue;
    const positions = e.positionsOverride && e.positionsOverride.length > 0 ? e.positionsOverride : p.positions;
    const list = out.get(p.team) ?? [];
    list.push({ id: p.id, name: p.name, positions, onIr: e.onIr });
    out.set(p.team, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
