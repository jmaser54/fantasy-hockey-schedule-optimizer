import { describe, expect, it } from 'vitest';
import type { SkaterStatLine } from '../data/format.ts';
import { RANKING_STATS, SCALED_STATS, UNCHANGED_STATS } from '../domain/evaluator.ts';
import { adjustedDecimals, formatAdjusted, formatStat, mergeComparisons, searchSkaters, sortRows, STAT_GROUPS, STAT_SHORT } from './evaluatorFormat.ts';

const s = (nhlId: number, name: string, gamesPlayed: number) => ({ nhlId, name, gamesPlayed }) as SkaterStatLine;

describe('Player Evaluator formatting', () => {
  it('stat groups cover every stat except GP exactly once, and every ranking stat has a short label', () => {
    const all = STAT_GROUPS.find((g) => g.id === 'all')!.stats;
    expect([...all].sort()).toEqual([...SCALED_STATS, ...UNCHANGED_STATS].filter((k) => k !== 'gamesPlayed').sort());
    expect(new Set(all).size).toBe(all.length);
    for (const k of RANKING_STATS) expect(STAT_SHORT[k]).toBeTruthy();
  });

  it('formats values by kind', () => {
    expect(formatAdjusted(12.3456)).toBe('12.35');
    // Per Game shows three decimals, every other benchmark two; trailing zeros kept.
    expect([adjustedDecimals('per-game'), adjustedDecimals('league-max'), adjustedDecimals('roster-max'), adjustedDecimals('custom'), adjustedDecimals('player'), adjustedDecimals(undefined)]).toEqual([3, 2, 2, 2, 2, 2]);
    expect(formatAdjusted(8.8, 2)).toBe('8.80');
    expect(formatAdjusted(0, 2)).toBe('0.00');
    expect(formatAdjusted(22.4166, 2)).toBe('22.42');
    expect(formatAdjusted(0.875, 3)).toBe('0.875');
    expect(formatAdjusted(0.9, 3)).toBe('0.900');
    expect(formatAdjusted(0, 3)).toBe('0.000');
    expect(formatAdjusted(1.23456, 3)).toBe('1.235');
    expect(formatStat('shootingPct', 0.1534)).toBe('15.3%');
    expect(formatStat('faceoffWinPct', null)).toBe('—');
    expect(formatStat('toiPerGame', 1411.6)).toBe('23:32');
    expect(formatStat('toiPerGame', 605)).toBe('10:05');
    expect(formatStat('plusMinus', 4)).toBe('+4');
    expect(formatStat('plusMinus', -3)).toBe('−3');
    expect(formatStat('plusMinus', 0)).toBe('0');
    expect(formatStat('goals', 7)).toBe('7');
  });
});

describe('searchSkaters', () => {
  const pool = [s(1, 'Elias Pettersson', 20), s(2, 'Elias Pettersson', 22), s(3, 'Connor McDavid', 24), s(4, 'Connor Bedard', 15), s(5, 'Tim Stützle', 23)];
  it('matches word prefixes, accent-insensitively, most games first', () => {
    expect(searchSkaters('connor', pool, new Set()).map((x) => x.nhlId)).toEqual([3, 4]);
    expect(searchSkaters('mcd', pool, new Set()).map((x) => x.nhlId)).toEqual([3]);
    expect(searchSkaters('stutzle', pool, new Set()).map((x) => x.nhlId)).toEqual([5]);
    expect(searchSkaters('elias pet', pool, new Set()).map((x) => x.nhlId)).toEqual([2, 1]);
  });
  it('skips excluded ids and too-short queries', () => {
    expect(searchSkaters('connor', pool, new Set([3])).map((x) => x.nhlId)).toEqual([4]);
    expect(searchSkaters('c', pool, new Set())).toEqual([]);
    expect(searchSkaters('  ', pool, new Set())).toEqual([]);
  });
});

describe('My Players (Roster Evaluation) row order', () => {
  const r = (id: number, position: SkaterStatLine['position'], source: 'roster' | 'comparison', goals = 1, status = 'ok') =>
    ({ id, source, status, stats: status === 'ok' ? ({ nhlId: id, position, goals, plusMinus: goals } as SkaterStatLine) : undefined, adjusted: status === 'ok' ? { goals } : null }) as const;
  const roster = [r(1, 'C', 'roster', 5), r(2, 'L', 'roster', 9), r(3, 'D', 'roster', 2), r(4, 'C', 'roster', 0, 'unmatched'), r(5, 'D', 'roster', 7)];

  it('inserts comparison players by position: same position, else forward/defense group, else the end', () => {
    const cmps = [r(10, 'D', 'comparison', 3), r(11, 'R', 'comparison', 4), r(12, 'C', 'comparison', 8), r(13, 'C', 'comparison', 0, 'no-games')];
    expect(mergeComparisons(roster, cmps).map((x) => x.id)).toEqual([1, 12, 2, 11, 3, 5, 10, 4, 13]);
    expect(mergeComparisons([], [r(10, 'D', 'comparison')]).map((x) => x.id)).toEqual([10]);
    expect(roster.map((x) => x.id)).toEqual([1, 2, 3, 4, 5]); // input untouched
  });

  it('sorts roster and comparison players together, missing values and players without stats last', () => {
    const merged = mergeComparisons(roster, [r(10, 'D', 'comparison', 3), r(12, 'C', 'comparison', 8)]);
    expect(sortRows(merged, 'goals', 'desc', true).map((x) => x.id)).toEqual([2, 12, 5, 1, 10, 3, 4]);
    expect(sortRows(merged, 'goals', 'asc', true).map((x) => x.id)).toEqual([3, 10, 1, 5, 12, 2, 4]);
    expect(sortRows(merged, 'plusMinus', 'desc', false).map((x) => x.id)).toEqual([2, 12, 5, 1, 10, 3, 4]);
    // Regular-stat sorting reads the actual total (stats) instead of the normalized value (adjusted).
    const diverge = [
      { ...r(1, 'C', 'roster'), stats: { nhlId: 1, position: 'C', goals: 10 } as SkaterStatLine, adjusted: { goals: 5 } },
      { ...r(2, 'C', 'comparison'), stats: { nhlId: 2, position: 'C', goals: 4 } as SkaterStatLine, adjusted: { goals: 8 } },
    ];
    expect(sortRows(diverge, 'goals', 'desc', true).map((x) => x.id)).toEqual([2, 1]);
    expect(sortRows(diverge, 'goals', 'desc', false).map((x) => x.id)).toEqual([1, 2]);
  });
});
