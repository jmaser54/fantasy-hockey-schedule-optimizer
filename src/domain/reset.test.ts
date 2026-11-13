import { describe, expect, it } from 'vitest';
import { initialState, reducer, type AppState } from '../state/appState.ts';
import { expandSeats, moveInLineup, optimizeDates, type DayResult } from './optimizer.ts';
import { toLineupPlayers } from './roster.ts';
import { sched, slots } from './testUtils.ts';
import type { Player, Position } from './types.ts';

// "Reset <period> to Optimal": the Lineup header dispatches clearManual for the period's edited days.
const DATES = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'];
const s = sched([
  ['2026-11-17', 'ANA', 'STL'], // Carlsson plays; MacKinnon (COL) doesn't
  ['2026-11-17', 'EDM', 'FLA'],
  ['2026-11-18', 'COL', 'UTA'],
  ['2026-11-19', 'ANA', 'COL'],
  ['2026-11-19', 'EDM', 'TBL'],
]);
const P = (id: string, team: string, positions: Position[]): Player => ({ id, name: id, team, positions, eligibilitySource: 'nhl' });
const directory = new Map([P('carlsson', 'ANA', ['C']), P('mackinnon', 'COL', ['C']), P('mcdavid', 'EDM', ['C']), P('terry', 'ANA', ['RW'])].map((p) => [p.id, p]));
const league = { rosterSize: 22, irSlots: 2, slots: [...slots({ C: [2, ['C']], RW: ['RW'], UTIL: ['C', 'LW', 'RW', 'D'], G: ['G'] }), { id: 'F', label: 'F', count: 1, accepts: ['C', 'LW', 'RW'] as Position[] }] };
const seats = expandSeats(league.slots);
const roster = (st: AppState) => toLineupPlayers(st.roster, directory);
const days = (st: AppState) => optimizeDates(DATES, roster(st), st.league, s, st.manual);
const lineup = (d: DayResult) => Object.fromEntries(d.seats.map((x) => [x.seat.key, x.playerId ?? null]));
const players = (st: AppState) => new Map(roster(st).map((p) => [p.id, p]));
/** One manual move, saved the way the day editor saves it. */
function move(st: AppState, date: string, id: string, seatKey: string | undefined, occupant: string | undefined): AppState {
  const next = moveInLineup(lineup(days(st).get(date)!), seats, players(st), id, seatKey, occupant)!;
  expect(next).not.toBeNull();
  return reducer(st, { type: 'setManual', date, override: { start: Object.values(next).filter((x): x is string => !!x), sit: [], lineup: next } });
}

describe('Reset <period> to Optimal', () => {
  const start = () => reducer(reducer({ ...initialState(), league }, { type: 'addPlayers', ids: ['mcdavid', 'carlsson', 'mackinnon', 'terry'] }), { type: 'updateEntry', id: 'mcdavid', patch: { preferred: true } });

  it('Carlsson case: benched, a non-playing player moved into his slot, then Reset puts the automatic lineup back', () => {
    let st = start();
    const auto = days(st);
    const carlssonSeat = auto.get('2026-11-17')!.seats.find((x) => x.playerId === 'carlsson')!.seat.key;
    // Move Carlsson to the bench, then move MacKinnon (no game on Nov 17) into the slot he left.
    st = move(st, '2026-11-17', 'carlsson', undefined, undefined);
    st = move(st, '2026-11-17', 'mackinnon', carlssonSeat, undefined);
    const edited = days(st).get('2026-11-17')!;
    expect(edited.seats.find((x) => x.seat.key === carlssonSeat)!.playerId).toBe('mackinnon');
    expect(edited.usable).toBe(auto.get('2026-11-17')!.usable - 1);
    // Reset Next Week to Optimal: the edited days in the period.
    const manualDates = DATES.filter((d) => days(st).get(d)!.manual);
    st = reducer(st, { type: 'clearManual', dates: manualDates });
    const after = days(st).get('2026-11-17')!;
    expect(after.manual).toBe(false);
    expect(after.seats.find((x) => x.playerId === 'carlsson')).toBeDefined();
    expect(after.seats.find((x) => x.playerId === 'mackinnon')).toBeUndefined();
    expect(after.usable).toBe(after.optimalUsable);
    expect(lineup(after)).toEqual(lineup(auto.get('2026-11-17')!));
  });

  it('re-optimizes every edited day in the period from scratch, with current stars, and keeps stars and other data', () => {
    let st = start();
    st = move(st, '2026-11-17', 'carlsson', undefined, undefined);
    st = move(st, '2026-11-19', 'mcdavid', undefined, undefined);
    st = move(st, '2026-11-19', 'carlsson', undefined, undefined);
    // A star change after the edits: Reset must use it.
    st = reducer(st, { type: 'updateEntry', id: 'carlsson', patch: { preferred: true } });
    const starsBefore = st.roster.map((e) => [e.playerId, !!e.preferred]);
    st = reducer(st, { type: 'clearManual', dates: DATES.filter((d) => days(st).get(d)!.manual) });
    // Every day now equals a fresh automatic computation with the current roster, schedule, eligibility and stars.
    const fresh = optimizeDates(DATES, roster(st), st.league, s, {});
    for (const d of DATES) {
      expect(days(st).get(d)!.manual).toBe(false);
      expect(lineup(days(st).get(d)!)).toEqual(lineup(fresh.get(d)!));
      expect(days(st).get(d)!.usable).toBe(fresh.get(d)!.optimalUsable);
    }
    expect(st.manual).toEqual({});
    expect(st.roster.map((e) => [e.playerId, !!e.preferred])).toEqual(starsBefore);
    expect(st.league).toEqual(league);
  });

  it('leaves edited days outside the period alone', () => {
    let st = start();
    st = move(st, '2026-11-17', 'carlsson', undefined, undefined);
    st = move(st, '2026-11-19', 'carlsson', undefined, undefined);
    st = reducer(st, { type: 'clearManual', dates: ['2026-11-17'] }); // a period containing only Nov 17
    expect(st.manual['2026-11-17']).toBeUndefined();
    expect(st.manual['2026-11-19']).toBeDefined();
  });
});
