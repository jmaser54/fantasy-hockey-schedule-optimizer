import { describe, expect, it } from 'vitest';
import { optimizeRange } from '../domain/optimizer.ts';
import { toLineupPlayers } from '../domain/roster.ts';
import { player as lp, sched, slots } from '../domain/testUtils.ts';
import type { Player } from '../domain/types.ts';
import { deserialize, initialState, proposedRoster, reducer, serialize, type AppState } from './appState.ts';

const P = (id: string, team: string, positions: Player['positions'] = ['C']): Player => ({ id, name: id, team, positions, eligibilitySource: 'nhl' });

describe('hypothetical transactions (spec case 11)', () => {
  const players = new Map([
    ['a', P('a', 'AAA')],
    ['b', P('b', 'BBB')],
    ['c', P('c', 'CCC')],
  ]);
  const schedule = sched([
    ['2027-03-01', 'AAA', 'XXX'],
    ['2027-03-02', 'BBB', 'YYY'],
    ['2027-03-03', 'CCC', 'ZZZ'],
    ['2027-03-04', 'CCC', 'XXX'],
  ]);
  const league = { slots: slots({ C: ['C'] }) };
  const usable = (entries: AppState['roster']) =>
    optimizeRange('2027-03-01', '2027-03-07', toLineupPlayers(entries, players), league, schedule).usable;

  it('dropping b for c updates the proposal without touching the saved roster', () => {
    let s = reducer(initialState(), { type: 'addPlayers', ids: ['a', 'b'] });
    const before = s.roster;
    s = reducer(s, { type: 'scenario', scenario: { drops: ['b'], adds: ['c'] } });
    expect(s.roster).toBe(before);
    expect(usable(s.roster)).toBe(2);
    expect(usable(proposedRoster(s))).toBe(3);

    // Removing the drop and the add individually returns the proposal to the current roster.
    s = reducer(s, { type: 'scenario', scenario: { drops: [], adds: [] } });
    expect(proposedRoster(s)).toEqual(before);

    // Update Roster makes the proposal the roster and clears the scenario.
    s = reducer(s, { type: 'scenario', scenario: { drops: ['b'], adds: ['c'] } });
    s = reducer(s, { type: 'scenarioApply' });
    expect(s.roster.map((e) => e.playerId)).toEqual(['a', 'c']);
    expect(s.scenario).toEqual({ drops: [], adds: [] });
  });

  it('daily choices survive unrelated edits and are cleared per date on reset', () => {
    let s = reducer(initialState(), { type: 'addPlayers', ids: ['a', 'b'] });
    s = reducer(s, { type: 'setManual', date: '2027-03-01', override: { start: ['b'], sit: [] } });
    s = reducer(s, { type: 'setManual', date: '2027-03-20', override: { start: [], sit: ['a'] } });
    s = reducer(s, { type: 'updateEntry', id: 'a', patch: { preferred: true } });
    s = reducer(s, { type: 'scenario', scenario: { drops: ['a'], adds: [] } });
    expect(Object.keys(s.manual)).toEqual(['2027-03-01', '2027-03-20']);
    // Period and custom-range changes keep choices on their own dates; they only apply when a window includes that date.
    s = reducer(s, { type: 'setPeriods', periods: [{ id: 'r1', name: 'Round 1', start: '2027-03-10', end: '2027-03-15' }] });
    s = reducer(s, { type: 'setCustom', start: '2027-03-02', end: '2027-03-03' });
    expect(s.manual).toEqual({ '2027-03-01': { start: ['b'], sit: [] }, '2027-03-20': { start: [], sit: ['a'] } });
    s = reducer(s, { type: 'clearManual', dates: ['2027-03-01'] });
    expect(Object.keys(s.manual)).toEqual(['2027-03-20']);
  });
});

describe('persistence (spec case 12)', () => {
  it('round-trips the saved state', () => {
    let s = reducer(initialState(), { type: 'addPlayers', ids: ['a', 'b'] });
    s = reducer(s, { type: 'updateEntry', id: 'b', patch: { onIr: true, markedInjured: true } });
    s = reducer(s, { type: 'setLeague', league: { ...s.league, rosterSize: 18, irSlots: 3 } });
    s = reducer(s, { type: 'setCustom', start: '2027-03-01', end: '2027-03-10' });
    s = reducer(s, { type: 'setManual', date: '2027-03-01', override: { start: ['a'], sit: ['b'] } });
    s = reducer(s, { type: 'updateEntry', id: 'a', patch: { preferred: true } });
    s = reducer(s, { type: 'scenario', scenario: { drops: ['a'], adds: ['c'] } });
    const { state, notice } = deserialize(serialize(s));
    expect(notice).toBeUndefined();
    expect(state).toEqual(s);
  });

  it('recovers from malformed or partial data without losing valid parts', () => {
    expect(deserialize('{not json').notice).toMatch(/unreadable/);
    const bad = JSON.stringify({ roster: [{ playerId: 'x', onIr: true }, { nope: 1 }, { playerId: 'x' }], league: { slots: 'broken' }, periods: [{ id: 'r1', name: 'R1', start: '2027-02-30', end: '2027-03-01' }] });
    const { state, notice } = deserialize(bad);
    expect(state.roster).toEqual([{ playerId: 'x', onIr: true }]);
    expect(state.league).toEqual(initialState().league);
    expect(state.periods).toEqual(initialState().periods);
    expect(notice).toMatch(/league settings and playoff dates/);
  });

  it('restores priorities and daily choices after a reload, and upgrades older saved lineups', () => {
    let s = reducer(initialState(), { type: 'addPlayers', ids: ['a', 'b'] });
    s = reducer(s, { type: 'updateEntry', id: 'b', patch: { preferred: true } });
    s = reducer(s, { type: 'setManual', date: '2027-03-05', override: { start: ['a'], sit: ['b'] } });
    const reloaded = deserialize(serialize(s)).state;
    expect(reloaded.roster).toEqual([{ playerId: 'a', onIr: false }, { playerId: 'b', onIr: false, preferred: true }]);
    expect(reloaded.manual).toEqual({ '2027-03-05': { start: ['a'], sit: ['b'] } });
    // Old format: a full lineup per date (seat → player). Its players become that date's starts.
    const old = JSON.stringify({ roster: [{ playerId: 'a', onIr: false }], manual: { '2027-03-05': { 'C#0': 'a', 'G#0': 'g' }, '2027-03-06': {}, bad: { x: 'a' } } });
    expect(deserialize(old).state.manual).toEqual({ '2027-03-05': { start: ['a', 'g'], sit: [] } });
  });

  it('starts fresh with nothing saved', () => {
    expect(deserialize(null)).toEqual({ state: initialState() });
  });
});

describe('roster operations', () => {
  it('clear roster removes every player and nothing else, and stays cleared after reload', () => {
    let s = reducer(initialState(), { type: 'addPlayers', ids: ['a', 'b', 'c'] });
    s = reducer(s, { type: 'updateEntry', id: 'b', patch: { onIr: true, markedInjured: true } });
    s = reducer(s, { type: 'setLeague', league: { ...s.league, rosterSize: 18, irSlots: 3 } });
    s = reducer(s, { type: 'setCustom', start: '2027-03-01', end: '2027-03-10' });
    s = reducer(s, { type: 'addCustomPlayer', player: { id: 'custom-1', name: 'New Guy', team: 'TOR', positions: ['C'], eligibilitySource: 'user' } });
    s = reducer(s, { type: 'setManual', date: '2027-03-01', override: { start: ['a'], sit: [] } });
    s = reducer(s, { type: 'scenario', scenario: { drops: ['a'], adds: ['z'] } });

    const cleared = reducer(s, { type: 'clearRoster' });
    expect(cleared.roster).toEqual([]);
    expect(cleared.manual).toEqual({});
    expect(cleared.scenario).toEqual({ drops: [], adds: ['z'] });
    // Unrelated data is untouched.
    expect(cleared.league).toBe(s.league);
    expect(cleared.periods).toBe(s.periods);
    expect(cleared.custom).toBe(s.custom);
    expect(cleared.selection).toBe(s.selection);
    expect(cleared.customPlayers).toBe(s.customPlayers);
    // Persisted state reloads empty.
    expect(deserialize(serialize(cleared)).state.roster).toEqual([]);
  });


  it('roster changes keep daily choices consistent; league changes keep the roster', () => {
    let s = reducer(initialState(), { type: 'addPlayers', ids: ['a', 'b', 'c', 'a'] });
    expect(s.roster).toHaveLength(3);
    s = reducer(s, { type: 'setManual', date: '2027-03-01', override: { start: ['a', 'b'], sit: [] } });
    s = reducer(s, { type: 'setManual', date: '2027-03-02', override: { start: ['c'], sit: [] } });
    // IR keeps the choice (the optimizer reports it as not applying while the player is on IR).
    s = reducer(s, { type: 'updateEntry', id: 'a', patch: { onIr: true } });
    expect(s.manual['2027-03-01']).toEqual({ start: ['a', 'b'], sit: [] });
    // Removing a player removes their choices; a date left with none becomes automatic again.
    s = reducer(s, { type: 'removePlayer', id: 'c' });
    expect(s.manual['2027-03-02']).toBeUndefined();
    // A player id migration carries choices and priority to the new id.
    s = reducer(s, { type: 'updateEntry', id: 'b', patch: { preferred: true } });
    s = reducer(s, { type: 'replacePlayer', from: 'b', to: 'b2' });
    expect(s.manual['2027-03-01']).toEqual({ start: ['a', 'b2'], sit: [] });
    expect(s.roster.find((e) => e.playerId === 'b2')).toEqual({ playerId: 'b2', onIr: false, preferred: true });
    // Un-preferring stores nothing.
    s = reducer(s, { type: 'updateEntry', id: 'b2', patch: { preferred: false } });
    expect(s.roster.find((e) => e.playerId === 'b2')).toEqual({ playerId: 'b2', onIr: false });
    // An empty choice set clears the date.
    s = reducer(s, { type: 'setManual', date: '2027-03-01', override: { start: [], sit: [] } });
    expect(s.manual).toEqual({});
    s = reducer(s, { type: 'setLeague', league: { ...s.league, rosterSize: 1 } });
    expect(s.roster).toHaveLength(2); // conflicts are reported, never auto-removed
  });

  it('IR players never add active capacity in the optimizer', () => {
    const players = new Map([['a', P('a', 'AAA')], ['b', P('b', 'AAA')]]);
    const r = optimizeRange(
      '2027-03-01',
      '2027-03-01',
      toLineupPlayers([{ playerId: 'a', onIr: false }, { playerId: 'b', onIr: true }], players),
      { slots: slots({ C: [2, ['C']] }) },
      sched([['2027-03-01', 'AAA', 'BBB']]),
    );
    expect(r.usable).toBe(1);
    expect(lp('x', 'AAA', ['C']).onIr).toBe(false);
  });
});
