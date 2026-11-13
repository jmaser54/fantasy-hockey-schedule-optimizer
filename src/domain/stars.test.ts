import { describe, expect, it } from 'vitest';
import { deserialize, initialState, reducer, serialize, type AppState } from '../state/appState.ts';
import { expandSeats, freezeOverride, optimizeDates, optimizeDay, type DayOverride, type DayResult } from './optimizer.ts';
import { toLineupPlayers } from './roster.ts';
import { sched, slots } from './testUtils.ts';
import type { Player, Position } from './types.ts';

// Two dates; every team plays both, so every player competes on both days.
const s = sched([
  ['2027-03-01', 'AAA', 'BBB'],
  ['2027-03-01', 'CCC', 'DDD'],
  ['2027-03-02', 'AAA', 'CCC'],
  ['2027-03-02', 'BBB', 'DDD'],
]);
const DATES = ['2027-03-01', '2027-03-02'];
const P = (id: string, team: string, positions: Position[]): Player => ({ id, name: id, team, positions, eligibilitySource: 'nhl' });
const directory = new Map(
  [
    P('d1', 'AAA', ['D']),
    P('d2', 'BBB', ['D']),
    P('d3', 'CCC', ['D']),
    P('dStar', 'DDD', ['D']),
    P('c1', 'AAA', ['C']),
    P('c2', 'BBB', ['C']),
    P('lw', 'CCC', ['LW']),
    P('cw', 'DDD', ['C', 'LW']),
    P('g1', 'AAA', ['G']),
  ].map((p) => [p.id, p]),
);
const league = { rosterSize: 22, irSlots: 2, slots: [...slots({ C: ['C'], LW: ['LW'], D: [2, ['D']], UTIL: ['C', 'LW', 'RW', 'D'], G: ['G'] }), { id: 'F', label: 'F', count: 1, accepts: ['C', 'LW', 'RW'] as Position[] }] };
const seats = expandSeats(league.slots);

function app(ids: string[]): AppState {
  return reducer({ ...initialState(), league }, { type: 'addPlayers', ids });
}
const star = (st: AppState, id: string, on = true) => reducer(st, { type: 'updateEntry', id, patch: { preferred: on } });
/** What the app computes for these dates from saved state (same call as App.tsx). */
const days = (st: AppState) => optimizeDates(DATES, toLineupPlayers(st.roster, directory), st.league, s, st.manual);
const starters = (d: DayResult) => new Set(d.seats.flatMap((x) => (x.playerId ? [x.playerId] : [])));
const lineup = (d: DayResult) => Object.fromEntries(d.seats.map((x) => [x.seat.key, x.playerId ?? null]));

describe('star priority in automatic lineups', () => {
  it('a single starred defenseman, last on the roster, starts over unstarred defensemen on every day', () => {
    const st = star(app(['d1', 'd2', 'd3', 'dStar']), 'dStar'); // 4 D for 3 D-eligible seats (2 D + UTIL)
    for (const d of days(st).values()) {
      expect(starters(d).has('dStar')).toBe(true);
      expect(d.usable).toBe(d.optimalUsable);
    }
  });

  it('a single starred forward starts over unstarred forwards', () => {
    const st = star(app(['c1', 'c2', 'lw', 'cw', 'd1', 'd2']), 'c2'); // c1/c2 compete for C, F, UTIL with cw
    const base = app(['c1', 'c2', 'lw', 'cw', 'd1', 'd2']);
    for (const date of DATES) {
      expect(starters(days(st).get(date)!).has('c2')).toBe(true);
      expect(days(st).get(date)!.usable).toBe(days(base).get(date)!.usable); // priority never costs a start
    }
  });

  it('multiple starred players: roster order breaks ties, and all starred players outrank unstarred', () => {
    const st = star(star(star(app(['d1', 'd2', 'd3', 'dStar']), 'd3'), 'dStar'), 'd2'); // 3 starred D for 3 seats
    for (const d of days(st).values()) expect([...starters(d)].filter((x) => x.startsWith('d')).sort()).toEqual(['d2', 'd3', 'dStar']);
    const two = reducer({ ...initialState(), league: { ...league, slots: slots({ D: [2, ['D']] }) } }, { type: 'addPlayers', ids: ['d1', 'd2', 'd3', 'dStar'] });
    const both = star(star(star(two, 'd2'), 'd3'), 'dStar'); // 3 starred for 2 seats: the first two on the roster
    for (const d of days(both).values()) expect([...starters(d)].sort()).toEqual(['d2', 'd3']);
  });

  it('players take their natural slot before F or UTIL, starred or not', () => {
    const st = star(app(['lw', 'c1']), 'lw');
    for (const d of days(st).values()) {
      const at = Object.fromEntries(d.seats.flatMap((x) => (x.playerId ? [[x.playerId, x.seat.label]] : [])));
      expect(at).toEqual({ lw: 'LW', c1: 'C' });
    }
  });

  it('goalie/skater limits hold for starred players', () => {
    const st = star(star(app(['g1', 'd1', 'd2', 'd3', 'dStar']), 'g1'), 'dStar');
    for (const d of days(st).values()) {
      for (const x of d.seats) {
        if (x.playerId === 'g1') expect(x.seat.label).toBe('G');
        if (x.seat.label === 'G') expect(x.playerId === undefined || x.playerId === 'g1').toBe(true);
      }
    }
  });
});

describe('star changes, manual days and Reset Day to Optimal', () => {
  const base = () => app(['d1', 'd2', 'd3', 'dStar']);

  it('starring a player immediately updates automatic days', () => {
    const before = days(base());
    const after = days(star(base(), 'dStar'));
    for (const date of DATES) {
      expect(starters(before.get(date)!).has('dStar')).toBe(false); // last on the roster: benched without a star
      expect(starters(after.get(date)!).has('dStar')).toBe(true);
    }
  });

  it('unstarring a player immediately updates automatic days', () => {
    const starred = star(base(), 'dStar');
    const after = days(star(starred, 'dStar', false));
    for (const date of DATES) expect(starters(after.get(date)!).has('dStar')).toBe(false);
  });

  it('starring or unstarring leaves a manually edited day exactly as saved', () => {
    let st = base();
    const edited = lineup(days(st).get('2027-03-01')!); // the user's saved lineup for Mar 1 (dStar benched)
    st = reducer(st, { type: 'setManual', date: '2027-03-01', override: { start: Object.values(edited).filter((x): x is string => !!x), sit: [], lineup: edited } });
    st = star(st, 'dStar');
    expect(lineup(days(st).get('2027-03-01')!)).toEqual(edited); // edited day unchanged
    expect(starters(days(st).get('2027-03-02')!).has('dStar')).toBe(true); // the automatic day follows the star
    st = star(st, 'dStar', false);
    expect(lineup(days(st).get('2027-03-01')!)).toEqual(edited);
  });

  it('older Start/Sit days stay unchanged too once saved as exact lineups (freezeOverride)', () => {
    const roster = toLineupPlayers(base().roster, directory);
    const legacy: DayOverride = { start: ['d3'], sit: [] }; // saved by the old Start button
    const shown = optimizeDay('2027-03-01', roster, seats, s, legacy);
    // Without freezing, a later star re-sorts the rest of that day (the bug):
    const starredRoster = toLineupPlayers(star(base(), 'dStar').roster, directory);
    expect(lineup(optimizeDay('2027-03-01', starredRoster, seats, s, legacy))).not.toEqual(lineup(shown));
    // Frozen, the day stays exactly as the user saw it, whatever the stars:
    const frozen = freezeOverride('2027-03-01', roster, seats, s, legacy);
    expect(lineup(optimizeDay('2027-03-01', roster, seats, s, frozen))).toEqual(lineup(shown));
    expect(lineup(optimizeDay('2027-03-01', starredRoster, seats, s, frozen))).toEqual(lineup(shown));
    expect(freezeOverride('2027-03-01', roster, seats, s, frozen)).toBe(frozen); // already exact: untouched
  });

  it('Reset Day to Optimal restores the star-prioritized automatic lineup and keeps every star', () => {
    let st = star(star(base(), 'dStar'), 'd2');
    const auto = lineup(days(st).get('2027-03-01')!);
    const manual = { ...auto, 'D#0': null }; // a manual move: a D sent to the bench
    st = reducer(st, { type: 'setManual', date: '2027-03-01', override: { start: [], sit: [], lineup: manual } });
    expect(lineup(days(st).get('2027-03-01')!)).toEqual(manual);
    const starsBefore = st.roster.map((e) => [e.playerId, !!e.preferred]);
    st = reducer(st, { type: 'setManual', date: '2027-03-01', override: null }); // what Reset Day to Optimal dispatches
    expect(st.manual['2027-03-01']).toBeUndefined();
    expect(lineup(days(st).get('2027-03-01')!)).toEqual(auto);
    expect(starters(days(st).get('2027-03-01')!).has('dStar')).toBe(true);
    expect(st.roster.map((e) => [e.playerId, !!e.preferred])).toEqual(starsBefore);
    // Resetting the whole period (clearManual) keeps stars too.
    st = reducer(reducer(st, { type: 'setManual', date: '2027-03-02', override: { start: [], sit: [], lineup: manual } }), { type: 'clearManual', dates: DATES });
    expect(st.roster.map((e) => [e.playerId, !!e.preferred])).toEqual(starsBefore);
  });

  it('the maximum number of starts is kept on automatic days with and without stars', () => {
    for (const st of [base(), star(base(), 'dStar'), star(star(base(), 'dStar'), 'd1')]) {
      for (const d of days(st).values()) expect(d.usable).toBe(d.optimalUsable);
    }
  });
});

describe('older Start/Sit days keep their warnings when saved as exact lineups', () => {
  const roster = (irId?: string) => toLineupPlayers(app(['d1', 'd2', 'd3', 'dStar']).roster.map((e) => (e.playerId === irId ? { ...e, onIr: true } : e)), directory);
  const legacy: DayOverride = { start: ['dStar'], sit: [] }; // the user started dStar, who has since gone on IR

  it('keeps the exact lineup and the "no longer applies" warning', () => {
    const before = optimizeDay('2027-03-01', roster('dStar'), seats, s, legacy);
    expect(before.manualIssues).toEqual(['dStar is on IR, so they can’t start.']);
    const frozen = freezeOverride('2027-03-01', roster('dStar'), seats, s, legacy);
    const after = optimizeDay('2027-03-01', roster('dStar'), seats, s, frozen);
    expect(lineup(after)).toEqual(lineup(before));
    expect(after.manualIssues).toEqual(before.manualIssues);
    expect(after.manual).toBe(true);
  });

  it('adds no warning to a day that had none', () => {
    const frozen = freezeOverride('2027-03-01', roster(), seats, s, { start: ['d3'], sit: [] });
    expect(frozen.notes).toBeUndefined();
    expect(optimizeDay('2027-03-01', roster(), seats, s, frozen).manualIssues).toEqual([]);
  });

  it('the warning survives a reload and a player id change, and goes away on Reset Day to Optimal', () => {
    const frozen = freezeOverride('2027-03-01', roster('dStar'), seats, s, legacy);
    let st = reducer(app(['d1', 'd2', 'd3', 'dStar']), { type: 'setManual', date: '2027-03-01', override: frozen });
    st = deserialize(serialize(st)).state;
    expect(st.manual['2027-03-01']!.notes).toEqual(frozen.notes);
    st = reducer(st, { type: 'replacePlayer', from: 'd1', to: 'd1b' });
    expect(st.manual['2027-03-01']!.notes).toEqual(frozen.notes);
    st = reducer(st, { type: 'setManual', date: '2027-03-01', override: null });
    expect(st.manual['2027-03-01']).toBeUndefined();
  });
});
