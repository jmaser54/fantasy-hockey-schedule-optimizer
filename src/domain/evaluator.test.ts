import { describe, expect, it } from 'vitest';
import type { SkaterStatLine } from '../data/format.ts';
import {
  adjustedValue,
  buildStatsIndex,
  classifyRoster,
  comparisonSubjects,
  DEFAULT_RANKING_MIN_GP,
  evaluatePlayers,
  evaluateSubject,
  rankPlayers,
  RANKING_STATS,
  SEASON_GAMES,
  resolveBenchmark,
  rosterNhlIds,
  SCALED_STATS,
  STAT_DEFINITIONS,
  UNCHANGED_STATS,
  type Subject,
} from './evaluator.ts';
import type { Player, RosterEntry } from './types.ts';

const line = (nhlId: number, gamesPlayed: number, extra: Partial<SkaterStatLine> = {}): SkaterStatLine => ({
  nhlId,
  name: `Skater ${nhlId}`,
  teams: ['TOR'],
  position: 'C',
  gamesPlayed,
  goals: 6,
  assists: 9,
  points: 15,
  plusMinus: 3,
  penaltyMinutes: 4,
  ppPoints: 5,
  shPoints: 1,
  shots: 40,
  hits: 12,
  blockedShots: 8,
  faceoffWins: 100,
  shootingPct: 0.15,
  faceoffWinPct: 0.52,
  toiPerGame: 1100,
  ...extra,
});

const player = (id: string, extra: Partial<Player> = {}): Player => ({ id, name: `Player ${id}`, team: 'TOR', positions: ['C'], eligibilitySource: 'espn', ...extra });
const entry = (playerId: string, extra: Partial<RosterEntry> = {}): RosterEntry => ({ playerId, onIr: false, ...extra });

// Directory: nhl-1/2/3 skaters with stats, nhl-4 a skater with no games, espn-5 ESPN-only, nhl-9 goalie, custom-1 user-made.
const directory = new Map<string, Player>([
  ['nhl-1', player('nhl-1', { nhlId: 1, name: 'Alpha' })],
  ['nhl-2', player('nhl-2', { nhlId: 2, name: 'Bravo', positions: ['LW', 'RW'] })],
  ['nhl-3', player('nhl-3', { nhlId: 3, name: 'Charlie', positions: ['D'] })],
  ['nhl-4', player('nhl-4', { nhlId: 4, name: 'Delta' })],
  ['espn-5', player('espn-5', { espnId: 5, name: 'Echo' })],
  ['nhl-9', player('nhl-9', { nhlId: 9, name: 'Goalie', positions: ['G'] })],
  ['custom-1', player('custom-1', { name: 'Custom', eligibilitySource: 'user' })],
]);
const resolve = (id: string) => directory.get(id) ?? [...directory.values()].find((p) => `espn-${p.espnId}` === id || `nhl-${p.nhlId}` === id);
const stats = buildStatsIndex([line(1, 20), line(2, 10, { goals: 5, points: 14 }), line(3, 20, { position: 'D' }), line(7, 15, { name: 'External' })]);

describe('statistic definitions', () => {
  it('cover every V1 statistic exactly once with the documented treatment', () => {
    expect(STAT_DEFINITIONS.map((d) => d.key).sort()).toEqual([...SCALED_STATS, ...UNCHANGED_STATS].sort());
    const treatment = Object.fromEntries(STAT_DEFINITIONS.map((d) => [d.key, d.treatment]));
    for (const k of SCALED_STATS) expect(treatment[k]).toBe('scaled');
    for (const k of ['gamesPlayed', 'plusMinus', 'shootingPct', 'faceoffWinPct', 'toiPerGame']) expect(treatment[k]).toBe('unchanged');
  });
});

describe('adjustedValue', () => {
  it('scales by benchmark / games played without rounding', () => {
    expect(adjustedValue(6, 10, 20)).toBe(12);
    expect(adjustedValue(5, 10, 18)).toBe(9);
    expect(adjustedValue(1, 3, 20)).toBeCloseTo(6.6667, 4);
    expect(adjustedValue(7, 20, 20)).toBe(7);
    expect(adjustedValue(0, 12, 20)).toBe(0);
    expect(adjustedValue(4, 20, 10)).toBe(2); // benchmark below actual GP scales down
  });

  it('never divides by zero or invents a value', () => {
    expect(adjustedValue(5, 0, 20)).toBeNull();
    expect(adjustedValue(5, undefined, 20)).toBeNull();
    expect(adjustedValue(5, 10, 0)).toBeNull();
    expect(adjustedValue(5, 10, undefined)).toBeNull();
    expect(adjustedValue(5, -1, 20)).toBeNull();
    expect(adjustedValue(Number.NaN, 10, 20)).toBeNull();
  });
});

describe('classifyRoster', () => {
  it('matches skaters by NHL id, excludes goalies and flags everything it cannot evaluate', () => {
    const roster = [entry('nhl-1'), entry('nhl-9'), entry('nhl-4'), entry('espn-5'), entry('custom-1'), entry('gone-7'), entry('nhl-3', { onIr: true })];
    const r = classifyRoster(roster, resolve, stats);
    expect(r.goalies).toEqual([{ playerId: 'nhl-9', name: 'Goalie' }]);
    expect(r.skaters.map((s) => [s.playerId, s.status])).toEqual([
      ['nhl-1', 'ok'],
      ['nhl-4', 'no-games'],
      ['espn-5', 'unmatched'],
      ['custom-1', 'unmatched'],
      ['gone-7', 'unknown-player'],
      ['nhl-3', 'ok'],
    ]);
    expect(r.skaters.find((s) => s.playerId === 'nhl-3')).toMatchObject({ onIr: true, nhlId: 3, name: 'Charlie' });
    expect(r.skaters[0]!.stats?.gamesPlayed).toBe(20);
  });

  it('never matches by name: an ESPN-only player stays unmatched even when a stats line has the same name', () => {
    const sameName = buildStatsIndex([line(55, 10, { name: 'Echo' })]);
    expect(classifyRoster([entry('espn-5')], resolve, sameName).skaters[0]!.status).toBe('unmatched');
  });

  it('honours position overrides for goalie exclusion and keeps players with no positions as skaters', () => {
    expect(classifyRoster([entry('nhl-1', { positionsOverride: ['G'] })], resolve, stats).goalies).toHaveLength(1);
    expect(classifyRoster([entry('nhl-9', { positionsOverride: ['C'] })], resolve, stats).skaters[0]!.status).toBe('no-games');
    const noPos = new Map([['nhl-1', player('nhl-1', { nhlId: 1, positions: [] })]]);
    expect(classifyRoster([entry('nhl-1')], (id) => noPos.get(id), stats).skaters[0]!.status).toBe('ok');
  });

  it('lists a player once when two saved ids resolve to them, and does not mutate the roster', () => {
    const alpha = directory.get('nhl-1')!;
    const aliasResolve = (id: string) => (id === 'nhl-1' || id === 'espn-501' ? alpha : resolve(id));
    const roster = Object.freeze([entry('nhl-1'), entry('espn-501'), entry('custom-1')]);
    const r = classifyRoster(roster, aliasResolve, stats);
    expect(r.skaters.map((s) => s.playerId)).toEqual(['nhl-1', 'custom-1']);
  });
});

describe('comparison players', () => {
  it('adds external skaters from the stats snapshot without touching the roster', () => {
    const r = comparisonSubjects([7, 7, 1, 404], stats, new Set([1]));
    expect(r.alreadyOnRoster).toEqual([1]);
    expect(r.subjects.map((s) => [s.nhlId, s.status, s.name, s.source])).toEqual([
      [7, 'ok', 'External', 'comparison'],
      [404, 'no-games', 'NHL player 404', 'comparison'],
    ]);
  });

  it('rosterNhlIds only includes roster players with an NHL id', () => {
    const { skaters } = classifyRoster([entry('nhl-1'), entry('nhl-4'), entry('espn-5')], resolve, stats);
    expect([...rosterNhlIds(skaters)].sort()).toEqual([1, 4]);
  });
});

describe('resolveBenchmark', () => {
  const skaters = classifyRoster([entry('nhl-2'), entry('nhl-1'), entry('nhl-3'), entry('nhl-4')], resolve, stats).skaters;

  it('league max (the default) is the highest GP in the whole snapshot, even when roster skaters have stats', () => {
    const fewGames = classifyRoster([entry('nhl-2')], resolve, stats).skaters; // Bravo: 10 GP
    expect(resolveBenchmark({ kind: 'league-max' }, fewGames, stats)).toMatchObject({ available: true, gamesPlayed: 20, basis: 'league-max', choice: { kind: 'league-max' } });
    expect(resolveBenchmark({ kind: 'league-max' }, fewGames, stats)).not.toHaveProperty('name');
    expect(resolveBenchmark({ kind: 'roster-max' }, fewGames, stats)).toMatchObject({ gamesPlayed: 10, basis: 'roster-max' });
    expect(resolveBenchmark({ kind: 'league-max' }, [], buildStatsIndex([]))).toMatchObject({ available: false, reason: 'no-stats' });
    const e = evaluatePlayers({ roster: [entry('nhl-2')], resolve, stats: buildStatsIndex([line(2, 10, { goals: 5 }), line(9, 25)]) });
    expect(e.benchmark).toMatchObject({ gamesPlayed: 25, basis: 'league-max' }); // default, whatever the roster's GP
    expect(e.roster[0]!.adjusted!.goals).toBe(12.5); // 5 / 10 * 25
  });

  it('Per Game is a built-in 1 GP benchmark: each counting stat per game played', () => {
    expect(resolveBenchmark({ kind: 'per-game' }, skaters, stats)).toEqual({ available: true, gamesPlayed: 1, choice: { kind: 'per-game' }, basis: 'per-game' });
    const e = evaluatePlayers({ roster: [entry('nhl-2')], resolve, stats: buildStatsIndex([line(2, 8, { goals: 7, assists: 9, points: 16 })]), benchmark: { kind: 'per-game' } });
    expect(e.benchmark).toMatchObject({ gamesPlayed: 1, basis: 'per-game' });
    expect(e.roster[0]!.adjusted).toMatchObject({ goals: 0.875, assists: 1.125, points: 2 }); // 7 / 8 × 1, 9 / 8 × 1, 16 / 8 × 1
    expect(e.roster[0]!.stats).toMatchObject({ goals: 7, gamesPlayed: 8 }); // actual values untouched
  });

  it('Full season (completed seasons) keeps the reported totals: nothing is scaled', () => {
    const e = evaluatePlayers({ roster: [entry('nhl-2')], resolve, stats: buildStatsIndex([line(2, 8, { goals: 7, assists: 9, points: 16 }), line(9, 82)]), benchmark: { kind: 'full-season' } });
    expect(e.benchmark).toMatchObject({ available: true, basis: 'full-season', gamesPlayed: 82 }); // league max, for labels only
    expect(e.roster[0]!.adjusted).toMatchObject({ goals: 7, assists: 9, points: 16 });
    expect(resolveBenchmark({ kind: 'full-season' }, [], buildStatsIndex([]))).toMatchObject({ available: false, reason: 'no-stats' });
  });

  it('roster max is the highest GP among roster skaters with stats (first in roster order on ties)', () => {
    expect(resolveBenchmark({ kind: 'roster-max' }, skaters, stats)).toMatchObject({ available: true, gamesPlayed: 20, nhlId: 1, name: 'Alpha', basis: 'roster-max' });
  });

  it('includes rostered IR skaters in the default benchmark', () => {
    const withIr = classifyRoster([entry('nhl-2'), entry('nhl-3', { onIr: true })], resolve, stats).skaters;
    expect(resolveBenchmark({ kind: 'roster-max' }, withIr, stats)).toMatchObject({ gamesPlayed: 20, nhlId: 3, basis: 'roster-max' });
  });

  it('falls back to the league-wide highest GP when no roster skater has stats, and says so', () => {
    const none = classifyRoster([entry('nhl-4'), entry('espn-5'), entry('nhl-9')], resolve, stats).skaters;
    const fallback = resolveBenchmark({ kind: 'roster-max' }, none, stats);
    expect(fallback).toMatchObject({ available: true, gamesPlayed: 20, basis: 'league-max' });
    expect(fallback).not.toHaveProperty('nhlId');
    expect(resolveBenchmark({ kind: 'roster-max' }, [], stats)).toMatchObject({ available: true, gamesPlayed: 20, basis: 'league-max' });
    expect(resolveBenchmark({ kind: 'roster-max' }, [], buildStatsIndex([]))).toMatchObject({ available: false, reason: 'no-stats' });
  });

  it('ignores comparison players for the default benchmark', () => {
    const comp: Subject = { source: 'comparison', nhlId: 7, name: 'External', status: 'ok', stats: line(7, 30) };
    expect(resolveBenchmark({ kind: 'roster-max' }, [...skaters, comp], stats)).toMatchObject({ gamesPlayed: 20 });
  });

  it('uses a chosen player’s GP, or reports that they have no stats', () => {
    expect(resolveBenchmark({ kind: 'player', nhlId: 7 }, skaters, stats)).toMatchObject({ available: true, gamesPlayed: 15, name: 'External', basis: 'player' });
    expect(resolveBenchmark({ kind: 'player', nhlId: 404 }, skaters, stats)).toMatchObject({ available: false, reason: 'player-has-no-stats' });
  });

  it('accepts a whole-number custom benchmark from 1 to the current season’s 84 games', () => {
    expect(SEASON_GAMES).toBe(84);
    expect(resolveBenchmark({ kind: 'custom', gamesPlayed: 84 }, skaters, stats)).toMatchObject({ available: true, gamesPlayed: 84, basis: 'custom' });
    expect(resolveBenchmark({ kind: 'custom', gamesPlayed: 1 }, skaters, stats)).toMatchObject({ available: true, gamesPlayed: 1 });
    for (const bad of [0, -5, 2.5, 85, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveBenchmark({ kind: 'custom', gamesPlayed: bad }, skaters, stats)).toMatchObject({ available: false, reason: 'invalid-custom' });
    }
  });
});

describe('evaluateSubject / evaluatePlayers', () => {
  it('adjusts every counting stat and leaves the source values untouched', () => {
    const s: Subject = { source: 'roster', nhlId: 2, name: 'Bravo', status: 'ok', stats: stats.get(2) };
    const e = evaluateSubject(s, { available: true, gamesPlayed: 20, choice: { kind: 'roster-max' }, basis: 'roster-max' });
    expect(e.adjusted).toEqual({ goals: 10, assists: 18, points: 28, ppPoints: 10, shPoints: 2, shots: 80, penaltyMinutes: 8, hits: 24, blockedShots: 16, faceoffWins: 200 });
    expect(e.stats).toBe(stats.get(2)); // actual totals, GP, +/-, percentages and TOI stay as reported
    expect(e.stats).toMatchObject({ gamesPlayed: 10, goals: 5, plusMinus: 3, shootingPct: 0.15, faceoffWinPct: 0.52, toiPerGame: 1100 });
  });

  it('keeps fractional adjusted values', () => {
    const s: Subject = { source: 'roster', nhlId: 8, name: 'x', status: 'ok', stats: line(8, 7, { goals: 3 }) };
    expect(evaluateSubject(s, { available: true, gamesPlayed: 18, choice: { kind: 'roster-max' }, basis: 'roster-max' }).adjusted!.goals).toBeCloseTo(7.7142857, 6);
  });

  it('has no adjusted values for players without stats or without a benchmark', () => {
    const none = { available: false as const, choice: { kind: 'roster-max' as const }, reason: 'no-stats' as const };
    expect(evaluateSubject({ source: 'roster', nhlId: 1, name: 'a', status: 'ok', stats: stats.get(1) }, none).adjusted).toBeNull();
    expect(evaluateSubject({ source: 'roster', nhlId: 4, name: 'd', status: 'no-games' }, { available: true, gamesPlayed: 20, choice: { kind: 'roster-max' }, basis: 'roster-max' }).adjusted).toBeNull();
  });

  it('evaluates the whole roster with comparisons, goalies and benchmark changes', () => {
    const roster = [entry('nhl-1'), entry('nhl-2'), entry('nhl-9'), entry('espn-5')];
    const base = evaluatePlayers({ roster, resolve, stats, comparisons: [7, 2] });
    expect(base.benchmark).toMatchObject({ available: true, gamesPlayed: 20 });
    expect(base.goalies.map((g) => g.name)).toEqual(['Goalie']);
    expect(base.alreadyOnRoster).toEqual([2]);
    expect(base.comparisons.map((c) => [c.nhlId, c.adjusted?.goals])).toEqual([[7, 8]]);
    expect(base.roster.map((r) => [r.name, r.status, r.adjusted?.goals ?? null])).toEqual([
      ['Alpha', 'ok', 6],
      ['Bravo', 'ok', 10],
      ['Echo', 'unmatched', null],
    ]);
    const custom = evaluatePlayers({ roster, resolve, stats, benchmark: { kind: 'custom', gamesPlayed: 40 } });
    expect(custom.roster.map((r) => r.adjusted?.goals ?? null)).toEqual([12, 20, null]);
    const byPlayer = evaluatePlayers({ roster, resolve, stats, comparisons: [7], benchmark: { kind: 'player', nhlId: 7 } });
    expect(byPlayer.benchmark).toMatchObject({ gamesPlayed: 15 });
    expect(byPlayer.roster[1]!.adjusted!.goals).toBe(7.5);
    expect(roster).toHaveLength(4); // the saved roster is never changed
  });

  it('handles an empty roster (league-max benchmark) and no stats at all', () => {
    const e = evaluatePlayers({ roster: [], resolve, stats, comparisons: [7] });
    expect(e).toMatchObject({ roster: [], goalies: [], benchmark: { available: true, gamesPlayed: 20, basis: 'league-max' } });
    expect(e.comparisons[0]!.adjusted!.goals).toBe(8);
    expect(evaluatePlayers({ roster: [], resolve, stats: buildStatsIndex([]) })).toMatchObject({ roster: [], comparisons: [], benchmark: { available: false, reason: 'no-stats' } });
  });

  it('evaluates rostered players whatever their GP (the rankings minimum does not apply)', () => {
    const few = buildStatsIndex([line(1, 2, { goals: 1 }), line(2, 1, { goals: 1 })]);
    const e = evaluatePlayers({ roster: [entry('nhl-1'), entry('nhl-2')], resolve, stats: few });
    expect(e.roster.map((r) => [r.nhlId, r.status, r.adjusted?.goals])).toEqual([
      [1, 'ok', 1],
      [2, 'ok', 2],
    ]);
  });

  it('applies the custom benchmark limit', () => {
    expect(evaluatePlayers({ roster: [], resolve, stats, benchmark: { kind: 'custom', gamesPlayed: 85 } }).benchmark).toMatchObject({ available: false, reason: 'invalid-custom' });
    expect(evaluatePlayers({ roster: [], resolve, stats, benchmark: { kind: 'custom', gamesPlayed: 84 } }).benchmark).toMatchObject({ available: true, gamesPlayed: 84 });
  });
});

describe('rankPlayers', () => {
  const league = [
    line(10, 20, { name: 'Ten', goals: 10, shots: 50, shootingPct: 0.2 }),
    line(11, 10, { name: 'Eleven', goals: 6, shots: 0, shootingPct: null, position: 'D' }),
    line(12, 5, { name: 'Twelve', goals: 2, shots: 20, shootingPct: 0.1 }),
    line(13, 4, { name: 'Thirteen', goals: 2, shots: 10, shootingPct: 0.2 }),
    line(14, 1, { name: 'Fourteen', goals: 1, shots: 2, shootingPct: 0.5 }),
  ];

  it('ranks league-wide by normalized value with actual GP alongside and roster flags', () => {
    const r = rankPlayers(league, { stat: 'goals', benchmarkGp: 20, minGamesPlayed: 1, rosterNhlIds: new Set([12]) });
    expect(r.map((x) => [x.rank, x.name, x.gamesPlayed, x.actual, x.value, x.onRoster])).toEqual([
      [1, 'Fourteen', 1, 1, 20, false],
      [2, 'Eleven', 10, 6, 12, false],
      [3, 'Ten', 20, 10, 10, false],
      [3, 'Thirteen', 4, 2, 10, false],
      [5, 'Twelve', 5, 2, 8, true],
    ]);
  });

  it('keeps the order for any benchmark; only displayed values change', () => {
    const at20 = rankPlayers(league, { stat: 'goals', benchmarkGp: 20, minGamesPlayed: 1 });
    const at82 = rankPlayers(league, { stat: 'goals', benchmarkGp: 82, minGamesPlayed: 1 });
    expect(at82.map((x) => [x.nhlId, x.rank])).toEqual(at20.map((x) => [x.nhlId, x.rank]));
    expect(at82[0]!.value).toBe(82);
  });

  it('defaults to a 10-game minimum, adjustable down to everyone', () => {
    expect(DEFAULT_RANKING_MIN_GP).toBe(10);
    expect(rankPlayers(league, { stat: 'goals', benchmarkGp: 20 }).map((x) => x.name)).toEqual(['Eleven', 'Ten']);
    expect(rankPlayers(league, { stat: 'goals', benchmarkGp: 20, minGamesPlayed: 5 }).map((x) => x.name)).toEqual(['Eleven', 'Ten', 'Twelve']);
    expect(rankPlayers(league, { stat: 'goals', benchmarkGp: 20, minGamesPlayed: 1 })).toHaveLength(5);
  });

  it('filters by NHL position and sorts either way', () => {
    expect(rankPlayers(league, { stat: 'goals', benchmarkGp: 20, minGamesPlayed: 1, positions: ['D'] }).map((x) => x.name)).toEqual(['Eleven']);
    expect(rankPlayers(league, { stat: 'goals', benchmarkGp: 20, minGamesPlayed: 1, direction: 'asc' })[0]!.name).toBe('Twelve');
  });

  it('offers PIM and +/- as ranking categories, sortable ascending and descending', () => {
    expect(RANKING_STATS).toEqual(expect.arrayContaining(['penaltyMinutes', 'plusMinus', 'points', 'toiPerGame']));
    expect(RANKING_STATS).not.toContain('gamesPlayed');
    expect(new Set(RANKING_STATS).size).toBe(RANKING_STATS.length);
    const pool = [line(20, 10, { name: 'A', plusMinus: 5, penaltyMinutes: 2 }), line(21, 20, { name: 'B', plusMinus: -3, penaltyMinutes: 30 }), line(22, 10, { name: 'C', plusMinus: 0, penaltyMinutes: 10 })];
    expect(rankPlayers(pool, { stat: 'plusMinus' }).map((x) => x.name)).toEqual(['A', 'C', 'B']);
    expect(rankPlayers(pool, { stat: 'plusMinus', direction: 'asc' }).map((x) => x.name)).toEqual(['B', 'C', 'A']);
    expect(rankPlayers(pool, { stat: 'penaltyMinutes', benchmarkGp: 20 }).map((x) => [x.name, x.value])).toEqual([['B', 30], ['C', 20], ['A', 4]]);
    expect(rankPlayers(pool, { stat: 'penaltyMinutes', benchmarkGp: 20, direction: 'asc' }).map((x) => x.name)).toEqual(['A', 'C', 'B']);
  });

  it('ranks unchanged stats on their reported values and lists unavailable values last, unranked', () => {
    const r = rankPlayers(league, { stat: 'shootingPct', minGamesPlayed: 1 });
    expect(r.map((x) => [x.rank, x.name, x.value])).toEqual([
      [1, 'Fourteen', 0.5],
      [2, 'Ten', 0.2],
      [2, 'Thirteen', 0.2],
      [4, 'Twelve', 0.1],
      [null, 'Eleven', null],
    ]);
  });

  it('can order and rank by the actual value instead of the normalized one, with the same displayed values', () => {
    const own = rankPlayers(league, { stat: 'goals', benchmarkGp: 'own', minGamesPlayed: 1 });
    expect(own.every((x) => x.value === x.actual)).toBe(true); // full season: actual totals, ranked on them
    expect(own.map((x) => x.actual)).toEqual([...own.map((x) => x.actual)].sort((a, b) => b! - a!));
    const r = rankPlayers(league, { stat: 'goals', benchmarkGp: 20, minGamesPlayed: 1, sortBy: 'actual' });
    expect(r.map((x) => [x.rank, x.name, x.actual, x.value])).toEqual([
      [1, 'Ten', 10, 10],
      [2, 'Eleven', 6, 12],
      [3, 'Twelve', 2, 8],
      [3, 'Thirteen', 2, 10],
      [5, 'Fourteen', 1, 20],
    ]);
    expect(rankPlayers(league, { stat: 'goals', benchmarkGp: 20, minGamesPlayed: 1, sortBy: 'actual', direction: 'asc' })[0]!.name).toBe('Fourteen');
    expect(rankPlayers(league, { stat: 'goals', benchmarkGp: 20, minGamesPlayed: 1, sortBy: 'normalized' })).toEqual(rankPlayers(league, { stat: 'goals', benchmarkGp: 20, minGamesPlayed: 1 }));
    // Unchanged stats are the same either way; unavailable values stay last and unranked.
    expect(rankPlayers(league, { stat: 'shootingPct', minGamesPlayed: 1, sortBy: 'actual' })).toEqual(rankPlayers(league, { stat: 'shootingPct', minGamesPlayed: 1 }));
  });

  it('requires a benchmark for scaled stats', () => {
    expect(() => rankPlayers(league, { stat: 'points' })).toThrow(/benchmarkGp/);
    expect(() => rankPlayers(league, { stat: 'points', benchmarkGp: 0 })).toThrow(/benchmarkGp/);
  });

  it('identifies players by NHL id, so same-name skaters stay distinct', () => {
    const twins = [line(1, 10, { name: 'Elias Pettersson', goals: 5 }), line(2, 10, { name: 'Elias Pettersson', position: 'D', goals: 1 })];
    const r = rankPlayers(twins, { stat: 'goals', benchmarkGp: 10, rosterNhlIds: new Set([2]) });
    expect(r.map((x) => [x.nhlId, x.position, x.onRoster])).toEqual([
      [1, 'C', false],
      [2, 'D', true],
    ]);
  });

  it('handles an empty league', () => {
    expect(rankPlayers([], { stat: 'goals', benchmarkGp: 20 })).toEqual([]);
  });
});
