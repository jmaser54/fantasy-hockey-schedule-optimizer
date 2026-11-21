import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rankPlayers } from '../domain/evaluator.ts';
import type { Player } from '../domain/types.ts';
import { deserialize, initialState, reducer, serialize } from '../state/appState.ts';
import { parseEvaluatorPrefs, serializeEvaluatorPrefs } from '../state/evaluatorPrefs.ts';
import { buildSkaterStats, evaluateSavedRoster } from './evaluatorData.ts';
import type { PlayersFile, SkaterStatLine, SkaterStatsFile } from './format.ts';

const stat = (nhlId: number, name: string, gamesPlayed: number, extra: Partial<SkaterStatLine> = {}): SkaterStatLine => ({
  nhlId,
  name,
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
const file = (skaters: SkaterStatLine[]): SkaterStatsFile => ({ version: 1, season: '20262027', gameType: 2, fetchedAt: '2026-11-20T12:00:00Z', source: 'test', skaters });
const P = (id: string, name: string, extra: Partial<Player> = {}): Player => ({ id, name, team: 'TOR', positions: ['C'], eligibilitySource: 'espn', ...extra });

// Directory: two NHL-matched skaters, an IR skater, a goalie, an ESPN-only skater; a custom player is user-made.
const players = [
  P('nhl-1', 'Alpha', { nhlId: 1 }),
  P('nhl-2', 'Bravo', { nhlId: 2, espnId: 22 }),
  P('nhl-3', 'Charlie', { nhlId: 3, positions: ['D'] }),
  P('nhl-9', 'Goalie', { nhlId: 9, positions: ['G'] }),
  P('espn-5', 'Echo', { espnId: 5 }),
];
const stats = file([stat(1, 'Alpha', 12), stat(2, 'Bravo', 6, { goals: 3, points: 12, shootingPct: 0.075 }), stat(3, 'Charlie', 20), stat(7, 'External', 15)]);

/** A saved roster exactly as the Roster tab persists it, read back the way the app loads it. */
function savedState() {
  let s = reducer(initialState(), { type: 'addCustomPlayer', player: P('custom-1', 'Custom', { eligibilitySource: 'user' }) });
  s = reducer(s, { type: 'addPlayers', ids: ['nhl-1', 'espn-22', 'nhl-3', 'nhl-9', 'espn-5', 'custom-1'] });
  s = reducer(s, { type: 'updateEntry', id: 'nhl-3', patch: { onIr: true } });
  return deserialize(serialize(s)).state;
}

describe('evaluateSavedRoster', () => {
  it('reads the saved roster: IR included, goalies excluded, ESPN-only and custom players unmatched, aliases resolved', () => {
    const saved = savedState();
    const r = evaluateSavedRoster(saved, players, stats);
    expect(r.evaluation.roster.map((x) => [x.playerId, x.nhlId ?? null, x.status])).toEqual([
      ['nhl-1', 1, 'ok'],
      ['espn-22', 2, 'ok'], // saved under its older ESPN id, matched through the alias
      ['nhl-3', 3, 'ok'],
      ['espn-5', null, 'unmatched'],
      ['custom-1', null, 'unmatched'],
    ]);
    expect(r.evaluation.goalies.map((g) => g.name)).toEqual(['Goalie']);
    expect(r.evaluation.benchmark).toMatchObject({ available: true, gamesPlayed: 20, basis: 'league-max', choice: { kind: 'league-max' } }); // the default
    expect(r.evaluation.roster[1]!.adjusted!.goals).toBe(10);
    const rosterMax = evaluateSavedRoster(saved, players, stats, { benchmark: { kind: 'roster-max' } });
    expect(rosterMax.evaluation.benchmark).toMatchObject({ available: true, gamesPlayed: 20, basis: 'roster-max', name: 'Charlie' }); // the IR skater sets it
    expect([...r.rosterNhlIds].sort()).toEqual([1, 2, 3]);
    expect(r).toMatchObject({ season: '20262027', statsFetchedAt: '2026-11-20T12:00:00Z' });
  });

  it('never changes the saved roster or app state', () => {
    const saved = savedState();
    const before = serialize(saved);
    evaluateSavedRoster(saved, players, stats, { comparisons: [7, 1], benchmark: { kind: 'player', nhlId: 7 } });
    evaluateSavedRoster(saved, players, stats, { benchmark: { kind: 'custom', gamesPlayed: 84 } });
    expect(serialize(saved)).toBe(before);
  });

  it('applies saved preferences: comparisons and an explicit benchmark', () => {
    const prefs = parseEvaluatorPrefs(serializeEvaluatorPrefs({ version: 1, comparisons: [7, 1], benchmark: { kind: 'player', nhlId: 7 }, minGamesPlayed: 10 }));
    const r = evaluateSavedRoster(savedState(), players, stats, prefs);
    expect(r.evaluation.comparisons.map((c) => c.name)).toEqual(['External']);
    expect(r.evaluation.alreadyOnRoster).toEqual([1]);
    expect(r.evaluation.benchmark).toMatchObject({ gamesPlayed: 15, basis: 'player' });
    expect(r.rosterNhlIds.has(7)).toBe(false); // comparisons are never roster players
  });

  it('the roster-max benchmark follows roster changes made in the Roster tab; league max does not', () => {
    const rosterMax = { benchmark: { kind: 'roster-max' as const } };
    let s = savedState();
    expect(evaluateSavedRoster(s, players, stats, rosterMax).evaluation.benchmark).toMatchObject({ gamesPlayed: 20 });
    s = reducer(s, { type: 'removePlayer', id: 'nhl-3' });
    expect(evaluateSavedRoster(s, players, stats, rosterMax).evaluation.benchmark).toMatchObject({ gamesPlayed: 12, name: 'Alpha' });
    expect(evaluateSavedRoster(s, players, stats).evaluation.benchmark).toMatchObject({ gamesPlayed: 20, basis: 'league-max' });
  });

  it('uses the league-wide highest GP, labelled as such, when no rostered skater has stats', () => {
    const r = evaluateSavedRoster(initialState(), players, stats);
    expect(r.evaluation.benchmark).toMatchObject({ available: true, gamesPlayed: 20, basis: 'league-max' });
    expect(r.evaluation.roster).toEqual([]);
  });

  it('feeds league-wide rankings with on-roster flags', () => {
    const r = evaluateSavedRoster(savedState(), players, stats);
    const bm = r.evaluation.benchmark;
    const ranked = rankPlayers([...r.stats.values()], { stat: 'goals', benchmarkGp: bm.available ? bm.gamesPlayed : 1, rosterNhlIds: r.rosterNhlIds, minGamesPlayed: 1 });
    expect(ranked.map((x) => [x.name, x.onRoster])).toEqual([
      ['Alpha', true],
      ['Bravo', true],
      ['External', false],
      ['Charlie', true],
    ]);
  });
});

describe('buildSkaterStats', () => {
  it('accepts a valid snapshot and rejects an invalid one', () => {
    expect(buildSkaterStats(stats)).toBe(stats);
    expect(() => buildSkaterStats({ ...stats, gameType: 3 })).toThrow(/game type/);
    expect(() => buildSkaterStats(stats, { season: '20252026' })).toThrow(/season/);
  });

  it('accepts the published snapshot, which evaluates against the published player directory', () => {
    const snapshot = buildSkaterStats(JSON.parse(readFileSync('public/data/skater-stats.json', 'utf8')));
    const directory = (JSON.parse(readFileSync('public/data/players.json', 'utf8')) as PlayersFile).players;
    const skaters = directory.filter((p) => p.nhlId !== undefined && !p.positions.includes('G') && snapshot.skaters.some((s) => s.nhlId === p.nhlId)).slice(0, 5);
    const saved = reducer(initialState(), { type: 'addPlayers', ids: skaters.map((p) => p.id) });
    const r = evaluateSavedRoster(saved, directory, snapshot);
    expect(r.evaluation.roster).toHaveLength(5);
    expect(r.evaluation.roster.every((x) => x.status === 'ok' && x.adjusted !== null)).toBe(true);
    expect(r.evaluation.benchmark).toMatchObject({ available: true, basis: 'league-max', gamesPlayed: Math.max(...snapshot.skaters.map((x) => x.gamesPlayed)) });
    expect(evaluateSavedRoster(saved, directory, snapshot, { benchmark: { kind: 'roster-max' } }).evaluation.benchmark).toMatchObject({
      available: true,
      basis: 'roster-max',
      gamesPlayed: Math.max(...r.evaluation.roster.map((x) => x.stats!.gamesPlayed)),
    });
  });
});
