import type { SkaterPositionCode, SkaterStatLine } from '../data/format.ts';
import type { StatKey } from '../domain/evaluator.ts';
import { normalizeName } from '../domain/names.ts';

/** Player Evaluator display helpers (pure). Layout choices here are prototype defaults, easy to change. */

export const STAT_SHORT: Record<StatKey, string> = {
  gamesPlayed: 'GP',
  goals: 'G',
  assists: 'A',
  points: 'P',
  plusMinus: '+/-',
  penaltyMinutes: 'PIM',
  ppPoints: 'PPP',
  shPoints: 'SHP',
  shots: 'SOG',
  shootingPct: 'S%',
  hits: 'HIT',
  blockedShots: 'BLK',
  faceoffWins: 'FOW',
  faceoffWinPct: 'FO%',
  toiPerGame: 'TOI',
};

export type StatGroupId = 'scoring' | 'peripherals' | 'rates' | 'all';
export const STAT_GROUPS: { id: StatGroupId; label: string; stats: StatKey[] }[] = [
  { id: 'scoring', label: 'Scoring', stats: ['goals', 'assists', 'points', 'ppPoints', 'shPoints'] },
  { id: 'peripherals', label: 'Peripherals', stats: ['shots', 'hits', 'blockedShots', 'penaltyMinutes', 'faceoffWins'] },
  { id: 'rates', label: 'Rates', stats: ['plusMinus', 'shootingPct', 'faceoffWinPct', 'toiPerGame'] },
];
STAT_GROUPS.push({ id: 'all', label: 'All', stats: STAT_GROUPS.flatMap((g) => g.stats) });

/** NHL position code as shown to fantasy managers. */
export const POSITION_SHORT: Record<SkaterPositionCode, string> = { C: 'C', L: 'LW', R: 'RW', D: 'D' };

/**
 * Normalized counting stats: two decimals, or three for the Per Game benchmark, trailing zeros kept
 * (8.80, 0.900). Display only: sorting and ranking use the full values; the full value is in the title.
 */
export const formatAdjusted = (v: number, decimals = 2): string => v.toFixed(decimals);
/** Decimal places for normalized values under a benchmark basis. */
export const adjustedDecimals = (basis: string | undefined): number => (basis === 'per-game' ? 3 : 2);

/** A reported value: counts as integers, +/- signed, percentages to one decimal, TOI as m:ss. */
export function formatStat(key: StatKey, v: number | null): string {
  if (v === null) return '—';
  if (key === 'shootingPct' || key === 'faceoffWinPct') return `${(v * 100).toFixed(1)}%`;
  if (key === 'toiPerGame') {
    const s = Math.round(v);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  if (key === 'plusMinus') return v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0';
  return String(v);
}

/** Skaters in the stats snapshot whose name contains every word of the query. */
export function searchSkaters(query: string, skaters: readonly SkaterStatLine[], exclude: ReadonlySet<number>, limit = 8): SkaterStatLine[] {
  const words = normalizeName(query).split(' ').filter(Boolean);
  if (words.length === 0 || words.join('').length < 2) return [];
  const out: SkaterStatLine[] = [];
  for (const s of skaters) {
    if (exclude.has(s.nhlId)) continue;
    const name = normalizeName(s.name);
    if (words.every((w) => name.split(' ').some((part) => part.startsWith(w)))) out.push(s);
  }
  return out.sort((a, b) => b.gamesPlayed - a.gamesPlayed || a.name.localeCompare(b.name)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Row order for the Player Evaluator tables

type Row = { source: 'roster' | 'comparison'; status: string; stats?: SkaterStatLine; adjusted?: Partial<Record<StatKey, number>> | null };

/**
 * Roster Evaluation's default order: rostered skaters with stats in roster order, each comparison
 * player inserted after the last one with the same NHL position (else the same group, forward or
 * defense; else at the end), then players without stats. Inputs are not changed.
 */
export function mergeComparisons<T extends Row>(roster: readonly T[], comparisons: readonly T[]): T[] {
  const ok = (r: T) => r.status === 'ok' && !!r.stats;
  const rows = roster.filter(ok);
  const isD = (p: SkaterPositionCode) => p === 'D';
  for (const c of comparisons.filter(ok)) {
    const pos = c.stats!.position;
    let at = -1;
    for (let i = 0; i < rows.length; i++) if (rows[i]!.stats!.position === pos) at = i;
    if (at < 0) for (let i = 0; i < rows.length; i++) if (isD(rows[i]!.stats!.position) === isD(pos)) at = i;
    rows.splice(at < 0 ? rows.length : at + 1, 0, c);
  }
  return [...rows, ...roster.filter((r) => !ok(r)), ...comparisons.filter((r) => !ok(r))];
}

/** A row's value for one column: normalized for counting stats, as reported otherwise. */
export function rowValue(r: Row, key: StatKey, scaled: boolean): number | null {
  if (!r.stats) return null;
  if (scaled) return r.adjusted?.[key] ?? null;
  return r.stats[key];
}

/** Sort rows with stats on one column (missing values last); rows without stats stay at the end, in order. */
export function sortRows<T extends Row>(rows: readonly T[], key: StatKey, dir: 'desc' | 'asc', scaled: boolean): T[] {
  const sign = dir === 'desc' ? -1 : 1;
  const withStats = rows.filter((r) => r.status === 'ok' && r.stats);
  const rest = rows.filter((r) => !(r.status === 'ok' && r.stats));
  const sorted = [...withStats].sort((a, b) => {
    const x = rowValue(a, key, scaled);
    const y = rowValue(b, key, scaled);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sign * (x - y);
  });
  return [...sorted, ...rest];
}
