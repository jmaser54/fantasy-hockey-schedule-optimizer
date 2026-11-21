import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialState, reducer, saveToStorage, serialize, storageKeyFor, STORAGE_KEY } from './appState.ts';
import {
  clearComparisons,
  defaultEvaluatorPrefs,
  EVALUATOR_PREFS_KEY,
  evaluatorPrefsKeyFor,
  loadEvaluatorPrefs,
  parseEvaluatorPrefs,
  saveEvaluatorPrefs,
  serializeEvaluatorPrefs,
} from './evaluatorPrefs.ts';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('evaluator preference keys', () => {
  it('are per site and never the saved-roster key', () => {
    expect(evaluatorPrefsKeyFor('/fantasy-hockey-schedule-optimizer-testing/')).toBe('playoff-evaluator-testing:v1');
    expect(evaluatorPrefsKeyFor('/fantasy-hockey-schedule-optimizer/')).toBe('playoff-evaluator:v1');
    expect(evaluatorPrefsKeyFor('/')).toBe('playoff-evaluator:v1');
    for (const base of ['/', '/fantasy-hockey-schedule-optimizer/', '/fantasy-hockey-schedule-optimizer-testing/']) {
      expect(evaluatorPrefsKeyFor(base)).not.toBe(storageKeyFor(base));
    }
    expect(EVALUATOR_PREFS_KEY).not.toBe(STORAGE_KEY);
  });
});

describe('parseEvaluatorPrefs', () => {
  it('defaults to no comparisons and the league-max benchmark', () => {
    expect(parseEvaluatorPrefs(null)).toEqual({ version: 2, comparisons: [], benchmark: { kind: 'league-max' }, minGamesPlayed: 10 });
    expect(parseEvaluatorPrefs('not json')).toEqual(defaultEvaluatorPrefs());
    expect(parseEvaluatorPrefs('[1,2]')).toEqual(defaultEvaluatorPrefs());
  });

  it('round-trips comparisons and each benchmark choice', () => {
    for (const benchmark of [{ kind: 'league-max' as const }, { kind: 'roster-max' as const }, { kind: 'player' as const, nhlId: 8478402 }, { kind: 'custom' as const, gamesPlayed: 60 }]) {
      const prefs = { version: 2, comparisons: [8478402, 8471675], benchmark, minGamesPlayed: 5 };
      expect(parseEvaluatorPrefs(serializeEvaluatorPrefs(prefs))).toEqual(prefs);
    }
  });

  it('stores benchmark choices, never a GP number, so they follow the data', () => {
    expect(JSON.parse(serializeEvaluatorPrefs(defaultEvaluatorPrefs())).benchmark).toEqual({ kind: 'league-max' });
    expect(JSON.parse(serializeEvaluatorPrefs({ ...defaultEvaluatorPrefs(), benchmark: { kind: 'roster-max' } }))).toMatchObject({ version: 2, benchmark: { kind: 'roster-max' } });
  });

  it('loads a version-1 roster-max (the old auto-saved default) as league max, and keeps explicit choices', () => {
    expect(parseEvaluatorPrefs(JSON.stringify({ version: 1, comparisons: [7], benchmark: { kind: 'roster-max' }, minGamesPlayed: 12 }))).toEqual({
      version: 2,
      comparisons: [7],
      benchmark: { kind: 'league-max' },
      minGamesPlayed: 12,
    });
    expect(parseEvaluatorPrefs(JSON.stringify({ version: 1, benchmark: { kind: 'custom', gamesPlayed: 60 } })).benchmark).toEqual({ kind: 'custom', gamesPlayed: 60 });
    expect(parseEvaluatorPrefs(JSON.stringify({ version: 1, benchmark: { kind: 'player', nhlId: 7 } })).benchmark).toEqual({ kind: 'player', nhlId: 7 });
    expect(parseEvaluatorPrefs(JSON.stringify({ version: 2, benchmark: { kind: 'roster-max' } })).benchmark).toEqual({ kind: 'roster-max' });
  });

  it('drops bad values field by field', () => {
    const p = parseEvaluatorPrefs(JSON.stringify({ comparisons: [5, 5, 'x', -1, 2.5, 7], benchmark: { kind: 'custom', gamesPlayed: 0 } }));
    expect(p).toEqual({ version: 2, comparisons: [5, 7], benchmark: { kind: 'league-max' }, minGamesPlayed: 10 });
    for (const bad of [0, 85, 2.5, '5']) expect(parseEvaluatorPrefs(JSON.stringify({ minGamesPlayed: bad })).minGamesPlayed).toBe(10);
    expect(parseEvaluatorPrefs(JSON.stringify({ minGamesPlayed: 1 })).minGamesPlayed).toBe(1);
    expect(parseEvaluatorPrefs(JSON.stringify({ comparisons: 'x', benchmark: { kind: 'player' } }))).toEqual(defaultEvaluatorPrefs());
  });
});

describe('clearComparisons', () => {
  it('removes every comparison player and keeps the other preferences', () => {
    const prefs = { version: 2, comparisons: [7, 8], benchmark: { kind: 'custom' as const, gamesPlayed: 40 }, minGamesPlayed: 5 };
    expect(clearComparisons(prefs)).toEqual({ ...prefs, comparisons: [] });
    expect(prefs.comparisons).toEqual([7, 8]); // input untouched
    for (const benchmark of [{ kind: 'league-max' as const }, { kind: 'roster-max' as const }]) expect(clearComparisons({ ...prefs, benchmark }).benchmark).toEqual(benchmark);
  });

  it('returns a cleared benchmark player to the default, league max', () => {
    expect(clearComparisons({ version: 2, comparisons: [7], benchmark: { kind: 'player', nhlId: 7 }, minGamesPlayed: 10 }).benchmark).toEqual({ kind: 'league-max' });
  });
});

describe('saving and loading evaluator preferences', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    (globalThis as { localStorage?: unknown }).localStorage = storage;
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('remembers selections between visits under their own key and leaves the saved roster untouched', () => {
    const state = reducer(initialState(), { type: 'addPlayers', ids: ['nhl-1', 'nhl-2'] });
    expect(saveToStorage(state)).toBe(true);
    const rosterBefore = storage.getItem(STORAGE_KEY);
    expect(rosterBefore).toBe(serialize(state));

    const prefs = { version: 2, comparisons: [7], benchmark: { kind: 'custom' as const, gamesPlayed: 40 }, minGamesPlayed: 3 };
    expect(saveEvaluatorPrefs(prefs)).toBe(true);
    expect(loadEvaluatorPrefs()).toEqual(prefs);
    expect(storage.getItem(STORAGE_KEY)).toBe(rosterBefore);
    expect([...storage.data.keys()].sort()).toEqual([EVALUATOR_PREFS_KEY, STORAGE_KEY].sort());
  });

  it('falls back to defaults when storage is missing or throws', () => {
    expect(loadEvaluatorPrefs()).toEqual(defaultEvaluatorPrefs());
    storage.getItem = () => {
      throw new Error('blocked');
    };
    storage.setItem = () => {
      throw new Error('blocked');
    };
    expect(loadEvaluatorPrefs()).toEqual(defaultEvaluatorPrefs());
    expect(saveEvaluatorPrefs(defaultEvaluatorPrefs())).toBe(false);
  });
});
