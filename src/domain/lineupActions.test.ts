import { describe, expect, it } from 'vitest';
import { initialState, reducer, type AppState } from '../state/appState.ts';
import { addOptions, benchStatus, gameKind, inAutomaticLineup, lineupOf, moveOptions, overrideFor, fillCandidates, planIrChange, placeOptions, playerSchedule, replaceOptions, summarizeDays } from './lineupActions.ts';
import { expandSeats, optimizeDates, optimizeDay, type LineupPlayer } from './optimizer.ts';
import { toLineupPlayers } from './roster.ts';
import { player, sched, slots } from './testUtils.ts';
import type { Player, Position } from './types.ts';

// Two C slots and one UTIL; three centers and a winger whose teams all play on Nov 17 and 18.
const DATES = ['2026-11-17', '2026-11-18', '2026-11-19'];
const s = sched([
  ['2026-11-17', 'EDM', 'TOR'],
  ['2026-11-17', 'COL', 'ANA'],
  ['2026-11-18', 'EDM', 'COL'],
  ['2026-11-18', 'TOR', 'ANA'],
  ['2026-11-19', 'EDM', 'TOR'],
]);
const P = (id: string, team: string, positions: Position[]): Player => ({ id, name: id, team, positions, eligibilitySource: 'nhl' });
const directory = new Map(
  [P('mcdavid', 'EDM', ['C']), P('matthews', 'TOR', ['C']), P('mackinnon', 'COL', ['C']), P('carlsson', 'ANA', ['C']), P('goalie', 'EDM', ['G'])].map((p) => [p.id, p]),
);
const league = { rosterSize: 22, irSlots: 2, slots: slots({ C: [2, ['C']], UTIL: ['C', 'LW', 'RW', 'D'] }) };
const seats = expandSeats(league.slots);
const roster = (st: AppState) => toLineupPlayers(st.roster, directory);
const days = (st: AppState) => optimizeDates(DATES, roster(st), st.league, s, st.manual);
const start = () => reducer({ ...initialState(), league }, { type: 'addPlayers', ids: ['mcdavid', 'matthews', 'mackinnon', 'carlsson'] });
/** Save a new lineup for one date, as the grid sheets do. */
const save = (st: AppState, date: string, next: Record<string, string | null>) =>
  reducer(st, { type: 'setManual', date, override: overrideFor(date, next, roster(st), seats, s, st.manual[date]?.notes) });

describe('manual changes from the grid', () => {
  it('stay on the selected date: other dates keep their lineups', () => {
    let st = start();
    const before = days(st);
    const day = before.get('2026-11-17')!;
    const benchMcDavid = moveOptions(day, 'mcdavid', roster(st), seats).find((o) => o.seatLabel === 'Bench')!;
    st = save(st, '2026-11-17', benchMcDavid.next);
    expect(Object.keys(st.manual)).toEqual(['2026-11-17']);
    const after = days(st);
    expect(after.get('2026-11-17')!.players.find((x) => x.playerId === 'mcdavid')!.seatKey).toBeUndefined();
    for (const d of ['2026-11-18', '2026-11-19']) expect(lineupOf(after.get(d)!)).toEqual(lineupOf(before.get(d)!));
  });

  it('a change back to the automatic lineup clears the date', () => {
    let st = start();
    const auto = lineupOf(days(st).get('2026-11-17')!);
    st = save(st, '2026-11-17', moveOptions(days(st).get('2026-11-17')!, 'mcdavid', roster(st), seats).find((o) => o.seatLabel === 'Bench')!.next);
    st = save(st, '2026-11-17', auto);
    expect(st.manual).toEqual({});
  });

  it('replacement suggestions name the game gained and the game given up, lowest priority first', () => {
    let st = reducer(start(), { type: 'updateEntry', id: 'matthews', patch: { preferred: true } });
    const day = days(st).get('2026-11-17')!; // 4 centers play, 3 seats: carlsson (last, not preferred) sits
    expect(gameKind(day, 'carlsson', new Map(roster(st).map((p) => [p.id, p])), seats)).toBe('priority');
    const opts = addOptions(day, 'carlsson', roster(st), seats);
    expect(opts.every((o) => o.kind === 'replace')).toBe(true);
    const gameOf = (id: string) => day.players.find((x) => x.playerId === id)!.game;
    for (const o of opts) {
      expect(o.gain).toBe(gameOf('carlsson'));
      expect(o.lose).toBe(gameOf(o.outId!));
      expect(o.next[o.seatKey]).toBe('carlsson');
      expect(Object.values(o.next)).not.toContain(o.outId);
    }
    // Suggested: the lowest-priority starter (mackinnon: not preferred, latest in roster order among starters).
    expect(opts[0]).toMatchObject({ suggested: true, outId: 'mackinnon' });
    expect(opts.find((o) => o.outId === 'matthews')?.suggested).toBeUndefined();
    // Applying it changes only that date.
    st = save(st, '2026-11-17', opts[0]!.next);
    expect(Object.keys(st.manual)).toEqual(['2026-11-17']);
    expect(days(st).get('2026-11-17')!.usable).toBe(3);
  });

  it('a game your change left out is an opportunity, with an open option that gives nothing up', () => {
    let st = start();
    st = save(st, '2026-11-17', moveOptions(days(st).get('2026-11-17')!, 'mcdavid', roster(st), seats).find((o) => o.seatLabel === 'Bench')!.next);
    const day = days(st).get('2026-11-17')!;
    const players = new Map(roster(st).map((p) => [p.id, p]));
    expect(gameKind(day, 'mcdavid', players, seats)).toBe('opportunity');
    expect(inAutomaticLineup('2026-11-17', 'mcdavid', roster(st), seats, s)).toBe(true);
    const [first] = addOptions(day, 'mcdavid', roster(st), seats);
    expect(first).toMatchObject({ kind: 'open' });
    expect(first!.lose).toBeUndefined();
    st = save(st, '2026-11-17', first!.next);
    expect(st.manual).toEqual({}); // back to the automatic lineup
  });

  it('a player no slot accepts is a constraint, not an opportunity', () => {
    const st = reducer(start(), { type: 'addPlayers', ids: ['goalie'] });
    const day = days(st).get('2026-11-17')!;
    expect(gameKind(day, 'goalie', new Map(roster(st).map((p) => [p.id, p])), seats)).toBe('constraint');
    expect(addOptions(day, 'goalie', roster(st), seats)).toEqual([]);
  });
});

describe('optimal baseline and opportunity indicators', () => {
  it('automatic days never show an opportunity (random rosters)', () => {
    const teams = ['EDM', 'TOR', 'COL', 'ANA', 'BOS', 'NYR'];
    const pos: Position[][] = [['C'], ['LW'], ['RW'], ['D'], ['C', 'LW'], ['LW', 'RW'], ['G'], ['C', 'RW']];
    const rs = sched(['2026-12-01', '2026-12-02', '2026-12-03'].flatMap((d, i) => [[d, teams[i]!, teams[i + 1]!] as [string, string, string], [d, teams[i + 2]!, teams[i + 3]!] as [string, string, string]]));
    const fullSeats = expandSeats(slots({ C: [2, ['C']], LW: [2, ['LW']], RW: [2, ['RW']], D: [2, ['D']], UTIL: ['C', 'LW', 'RW', 'D'], G: [2, ['G']] }));
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 9301 + 49297) % 233280), Math.floor((seed / 233280) * n));
    for (let trial = 0; trial < 60; trial++) {
      const r: LineupPlayer[] = Array.from({ length: 10 + rnd(10) }, (_, i) => ({ ...player(`p${i}`, teams[rnd(teams.length)]!, pos[rnd(pos.length)]!, rnd(10) === 0), preferred: rnd(4) === 0 }));
      const players = new Map(r.map((p) => [p.id, p]));
      for (const d of ['2026-12-01', '2026-12-02', '2026-12-03']) {
        const day = optimizeDay(d, r, fullSeats, rs);
        for (const p of r) expect(gameKind(day, p.id, players, fullSeats)).not.toBe('opportunity');
        // In-lineup games are exactly the day's usable games.
        expect(r.filter((p) => gameKind(day, p.id, players, fullSeats) === 'in-lineup').length).toBe(day.usable);
      }
    }
  });
});

describe('IR changes', () => {
  it('moving a starter to IR re-optimizes the selected period: automatic days refill on their own', () => {
    const st = start();
    const plan = planIrChange('mcdavid', true, roster(st), DATES, seats, s, st.manual);
    expect(plan.manual).toEqual({}); // no edited days: nothing to save, the optimizer refills
    const nov17 = plan.changes.find((c) => c.date === '2026-11-17')!;
    expect(nov17.removed).toEqual(['mcdavid']);
    expect(nov17.added).toEqual(['carlsson']); // the bench player with a game takes the spot
    const after = reducer(st, { type: 'applyIrChange', id: 'mcdavid', onIr: true, manual: plan.manual });
    expect(after.roster.find((e) => e.playerId === 'mcdavid')!.onIr).toBe(true);
    expect(days(after).get('2026-11-17')!.usable).toBe(3);
    expect(plan.after).toBe([...days(after).values()].reduce((n, d) => n + d.usable, 0));
  });

  it('on a day you changed, only the IR player’s seat is refilled; the rest of your lineup stays', () => {
    let st = reducer(start(), { type: 'updateEntry', id: 'matthews', patch: { preferred: true } });
    // Your change on Nov 17: Carlsson replaces MacKinnon.
    const opt = addOptions(days(st).get('2026-11-17')!, 'carlsson', roster(st), seats).find((o) => o.outId === 'mackinnon')!;
    st = save(st, '2026-11-17', opt.next);
    const mine = st.manual['2026-11-17']!.lineup!;
    const plan = planIrChange('mcdavid', true, roster(st), DATES, seats, s, st.manual);
    expect('2026-11-17' in plan.manual).toBe(true);
    const after = reducer(st, { type: 'applyIrChange', id: 'mcdavid', onIr: true, manual: plan.manual });
    // Saved as is, or cleared when the refilled lineup equals the automatic one; either way the day shows:
    const shown = lineupOf(days(after).get('2026-11-17')!);
    const mcSeat = Object.keys(mine).find((k) => mine[k] === 'mcdavid')!;
    expect(shown[mcSeat]).toBe('mackinnon'); // the bench player with a game fills McDavid's seat
    for (const k of Object.keys(mine)) if (k !== mcSeat) expect(shown[k]).toBe(mine[k]); // nobody else moves
    expect(days(after).get('2026-11-17')!.manualIssues).toEqual([]);
    expect(plan.changes.find((c) => c.date === '2026-11-17')).toEqual({ date: '2026-11-17', added: ['mackinnon'], removed: ['mcdavid'] });
  });

  it('dates outside the selected period are left as saved; coming off IR keeps your edited days', () => {
    let st = start();
    st = save(st, '2026-11-19', moveOptions(days(st).get('2026-11-19')!, 'mcdavid', roster(st), seats).find((o) => o.seatLabel === 'Bench')!.next);
    const outside = planIrChange('matthews', true, roster(st), ['2026-11-17'], seats, s, st.manual);
    expect(Object.keys(outside.manual)).toEqual([]);
    st = reducer(st, { type: 'applyIrChange', id: 'mcdavid', onIr: true, manual: planIrChange('mcdavid', true, roster(st), DATES, seats, s, st.manual).manual });
    const saved = st.manual['2026-11-19'];
    const back = planIrChange('mcdavid', false, roster(st), DATES, seats, s, st.manual);
    expect(back.manual).toEqual({});
    st = reducer(st, { type: 'applyIrChange', id: 'mcdavid', onIr: false, manual: back.manual });
    expect(st.manual['2026-11-19']).toEqual(saved);
    // Automatic days pick him up again.
    expect(days(st).get('2026-11-17')!.players.find((x) => x.playerId === 'mcdavid')!.seatKey).toBeDefined();
  });
});

describe('replacing a starter from the bench (both directions)', () => {
  // Two D seats; three defensemen who all play on Dec 2.
  const ds = sched([['2026-12-02', 'ANA', 'COL'], ['2026-12-02', 'SJS', 'VGK']]);
  const D = (id: string, team: string): Player => ({ id, name: id, team, positions: ['D'], eligibilitySource: 'nhl' });
  const dir = new Map([D('zadorov', 'ANA'), D('makar', 'COL'), D('luneau', 'SJS')].map((p) => [p.id, p]));
  const dLeague = { rosterSize: 22, irSlots: 2, slots: slots({ D: [2, ['D']] }) };
  const dSeats = expandSeats(dLeague.slots);
  const r = (st: AppState) => toLineupPlayers(st.roster, dir);
  const day = (st: AppState) => optimizeDates(['2026-12-02'], r(st), st.league, ds, st.manual).get('2026-12-02')!;
  const put = (st: AppState, next: Record<string, string | null>) => reducer(st, { type: 'setManual', date: '2026-12-02', override: overrideFor('2026-12-02', next, r(st), dSeats, ds) });

  it('Luneau/Zadorov: after Luneau replaces Zadorov, selecting Luneau offers Zadorov back, with the games gained and given up', () => {
    let st = reducer({ ...initialState(), league: dLeague }, { type: 'addPlayers', ids: ['zadorov', 'makar', 'luneau'] });
    expect(day(st).players.find((x) => x.playerId === 'luneau')!.seatKey).toBeUndefined(); // Luneau sits (last in roster order)
    const swapIn = addOptions(day(st), 'luneau', r(st), dSeats).find((o) => o.outId === 'zadorov')!;
    st = put(st, swapIn.next);
    expect(day(st).players.find((x) => x.playerId === 'zadorov')!.seatKey).toBeUndefined();
    // From Luneau's row: Zadorov is a replacement, net 0 (one game for another).
    const back = replaceOptions(day(st), 'luneau', r(st), dSeats);
    const z = back.find((o) => o.inId === 'zadorov')!;
    expect(z).toMatchObject({ net: 0 });
    expect(z.gain).toBe(day(st).players.find((x) => x.playerId === 'zadorov')!.game);
    expect(z.lose).toBe(day(st).players.find((x) => x.playerId === 'luneau')!.game);
    expect(z.next[z.seatKey]).toBe('zadorov');
    st = put(st, z.next);
    expect(st.manual).toEqual({}); // reversed: back to the automatic lineup
  });

  it('replacements never include IR or seated players, and put players with a game first', () => {
    let st = reducer({ ...initialState(), league: dLeague }, { type: 'addPlayers', ids: ['zadorov', 'makar', 'luneau'] });
    st = reducer(st, { type: 'updateEntry', id: 'luneau', patch: { onIr: true } });
    expect(replaceOptions(day(st), 'zadorov', r(st), dSeats)).toEqual([]);
  });
});

describe('period overview', () => {
  it('per-day figures match the day results; open spots only on edited days', () => {
    let st = start();
    const summaries = () => summarizeDays([...days(st).values()], roster(st), seats);
    for (const sm of summaries()) {
      const d = days(st).get(sm.date)!;
      expect(sm).toMatchObject({ usable: d.usable, scheduled: d.scheduled, optimal: d.optimalUsable, manual: false, opportunities: [] });
    }
    st = save(st, '2026-11-17', moveOptions(days(st).get('2026-11-17')!, 'mcdavid', roster(st), seats).find((o) => o.seatLabel === 'Bench')!.next);
    const nov17 = summaries().find((x) => x.date === '2026-11-17')!;
    expect(nov17.manual).toBe(true);
    expect(nov17.opportunities).toContain('mcdavid');
    expect(summaries().filter((x) => x.date !== '2026-11-17').every((x) => x.opportunities.length === 0)).toBe(true);
  });
});

describe('schedule view cells', () => {
  it('show every game, assigned exactly when it is in the lineup, and follow saved changes', () => {
    let st = start();
    const list = () => [...days(st).values()];
    const total = (id: string) => summarizeRange(id);
    function summarizeRange(id: string) {
      return list().reduce((n, d) => n + Number(!!d.players.find((x) => x.playerId === id && x.game && x.seatKey)), 0);
    }
    for (const p of roster(st)) {
      const cells = playerSchedule(list(), p.id);
      expect(cells.map((c) => c.date)).toEqual(DATES);
      expect(cells.filter((c) => c.assigned).length).toBe(total(p.id));
      for (const c of cells) if (!c.game) expect(c.assigned).toBe(false); // no game: empty cell
    }
    // A change saved for Nov 17 (as the Lineup view saves it) shows in the schedule at once.
    st = save(st, '2026-11-17', moveOptions(days(st).get('2026-11-17')!, 'mcdavid', roster(st), seats).find((o) => o.seatLabel === 'Bench')!.next);
    const mc = playerSchedule(list(), 'mcdavid');
    expect(mc.find((c) => c.date === '2026-11-17')).toMatchObject({ assigned: false });
    expect(mc.find((c) => c.date === '2026-11-17')!.game).toBeDefined();
    expect(mc.find((c) => c.date === '2026-11-18')).toMatchObject({ assigned: true });
  });
});

describe('filling empty slots with players without a game (ESPN-style, 2026-11-24)', () => {
  // Two G seats, two C seats. Dec 9: only EDM plays.
  const gs = sched([['2026-12-09', 'EDM', 'CGY']]);
  const gLeague = { rosterSize: 22, irSlots: 2, slots: slots({ C: [2, ['C']], G: [2, ['G']] }) };
  const gSeats = expandSeats(gLeague.slots);
  const day = (r: LineupPlayer[], o?: Parameters<typeof optimizeDay>[4]) => optimizeDay('2026-12-09', r, gSeats, gs, o);
  const seated = (d: ReturnType<typeof day>, id: string) => d.seats.some((x) => x.playerId === id);

  it('one rostered goalie fills one goalie slot; the other stays genuinely empty', () => {
    const d = day([player('skinner', 'TOR', ['G']), player('mcdavid', 'EDM', ['C'])]);
    const g = d.seats.filter((x) => x.seat.slotId === 'G');
    expect(g.filter((x) => x.playerId).map((x) => x.playerId)).toEqual(['skinner']); // no game, still in the lineup
    expect(g.filter((x) => !x.playerId)).toHaveLength(1); // the roster has no second goalie
    expect(d.usable).toBe(1); // only McDavid's game counts
  });

  it('two goalies, only one playing: both goalie slots are occupied, the idle one adds no game', () => {
    const d = day([player('skinner', 'EDM', ['G']), player('stolarz', 'TOR', ['G'])]);
    expect(seated(d, 'skinner') && seated(d, 'stolarz')).toBe(true);
    expect(d.usable).toBe(1);
    expect(d.goalieUsable).toBe(1);
    expect(d.players.find((x) => x.playerId === 'stolarz')!.game).toBeUndefined();
  });

  it('never changes who plays or how many games count (random rosters)', () => {
    const teams = ['EDM', 'TOR', 'COL', 'ANA', 'BOS', 'NYR'];
    const pos: Position[][] = [['C'], ['LW'], ['RW'], ['D'], ['C', 'LW'], ['G'], ['LW', 'RW']];
    const rs = sched([['2026-12-01', 'EDM', 'TOR'], ['2026-12-01', 'COL', 'ANA']]);
    const full = expandSeats(slots({ C: [2, ['C']], LW: [2, ['LW']], RW: [2, ['RW']], D: [2, ['D']], UTIL: ['C', 'LW', 'RW', 'D'], G: [2, ['G']] }));
    let seed = 11;
    const rnd = (n: number) => ((seed = (seed * 9301 + 49297) % 233280), Math.floor((seed / 233280) * n));
    for (let t = 0; t < 80; t++) {
      const r: LineupPlayer[] = Array.from({ length: 6 + rnd(16) }, (_, i) => ({ ...player(`p${i}`, teams[rnd(teams.length)]!, pos[rnd(pos.length)]!, rnd(9) === 0), preferred: rnd(4) === 0 }));
      const d = optimizeDay('2026-12-01', r, full, rs);
      // Players with a game: the same set as the lineup of playing players alone would seat.
      const playingOnly = optimizeDay('2026-12-01', r.filter((p) => d.players.find((x) => x.playerId === p.id)!.game), full, rs);
      const withGame = (x: typeof d) => x.players.filter((s) => s.seatKey && s.game).map((s) => s.playerId).sort();
      expect(withGame(d)).toEqual(withGame(playingOnly));
      expect(d.usable).toBe(d.optimalUsable);
      // No seat is left empty while an eligible non-IR player sits on the bench.
      for (const { seat, playerId } of d.seats) {
        if (playerId) continue;
        const benchFits = r.some((p) => !p.onIr && !d.seats.some((x) => x.playerId === p.id) && p.positions.some((x) => seat.accepts.includes(x)));
        expect(benchFits).toBe(false);
      }
    }
  });

  it('a saved lineup keeps its empty slot (never refilled automatically); the user can fill it with a player without a game', () => {
    const r = [player('skinner', 'TOR', ['G']), player('stolarz', 'BOS', ['G']), player('mcdavid', 'EDM', ['C'])];
    const auto = day(r);
    const gSeat = auto.seats.find((x) => x.playerId === 'stolarz')!.seat.key;
    const saved = { ...lineupOf(auto), [gSeat]: null };
    const d = day(r, { start: [], sit: [], lineup: saved });
    expect(d.seats.find((x) => x.seat.key === gSeat)!.playerId).toBeUndefined(); // as you saved it
    const cands = fillCandidates(d, gSeat, r, gSeats);
    expect(cands.map((c) => c.playerId)).toEqual(['stolarz']); // no game, still offered
    expect(cands[0]!.option).toMatchObject({ net: 0, gain: undefined, lose: undefined });
    expect(cands[0]!.option.next[gSeat]).toBe('stolarz');
    // A bench player without a game can also take a seat held by a player with one (costs that game).
    const swap = placeOptions(day(r), 'stolarz', r, gSeats);
    expect(swap).toEqual([]); // already in the lineup automatically
    const idleBench = [...r, player('pickard', 'VAN', ['G'])]; // no game, and both goalie seats are taken
    const opts = placeOptions(day(idleBench), 'pickard', idleBench, gSeats);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => o.gain === undefined)).toBe(true);
  });
});

describe('day and bench indicators (crimson avoidable / yellow capacity, 2026-11-26)', () => {
  // One date: A, B, C and D play; team E doesn't.
  const D = '2027-03-01';
  const sc = sched([
    [D, 'A', 'B'],
    [D, 'C', 'D'],
  ]);
  const pl = (id: string, team: string, positions: Position[], onIr = false) => player(id, team, positions, onIr);
  const run = (r: LineupPlayer[], st: ReturnType<typeof expandSeats>, lineup?: Record<string, string | null>) => {
    const day = optimizeDay(D, r, st, sc, lineup ? { start: Object.values(lineup).filter((x): x is string => !!x), sit: [], lineup } : undefined);
    const summary = summarizeDays([day], r, st)[0]!;
    const by = new Map(r.map((p) => [p.id, p]));
    const status = (id: string) => benchStatus(day, id, by, st);
    return { day, summary, status };
  };
  const CL = expandSeats(slots({ C: ['C'], LW: ['LW'] }));

  it('an empty eligible slot with a benched player who has a game is crimson', () => {
    const r = [pl('c1', 'A', ['C']), pl('w1', 'C', ['LW'])];
    const { summary, status } = run(r, CL, { 'C#0': null, 'LW#0': 'w1' });
    expect(summary.attention).toBe('avoidable');
    expect(summary.opportunities).toEqual(['c1']);
    expect(status('c1')).toBe('avoidable');
  });

  it('a slot held by a player without a game counts as open (crimson)', () => {
    const r = [pl('c1', 'A', ['C']), pl('idle', 'E', ['C']), pl('w1', 'C', ['LW'])];
    const { summary, status } = run(r, CL, { 'C#0': 'idle', 'LW#0': 'w1' });
    expect(summary.attention).toBe('avoidable');
    expect(status('c1')).toBe('avoidable');
    expect(status('idle')).toBeUndefined(); // no game: never flagged
  });

  it('an opportunity that needs starters reshuffled is crimson', () => {
    // f1 (C/LW) holds C; LW is empty; c2 (C only) fits once f1 moves to LW.
    const r = [pl('f1', 'A', ['C', 'LW']), pl('c2', 'C', ['C'])];
    const { summary, status } = run(r, CL, { 'C#0': 'f1', 'LW#0': null });
    expect(status('c2')).toBe('avoidable');
    expect(summary.attention).toBe('avoidable');
  });

  it('only priority players (more games than slots) is yellow', () => {
    const r = [pl('c1', 'A', ['C']), pl('c2', 'C', ['C']), pl('w1', 'B', ['LW'])];
    const { day, summary, status } = run(r, CL);
    expect(day.manual).toBe(false);
    expect(summary.attention).toBe('capacity');
    expect(summary.opportunities).toEqual([]);
    expect(summary.noRoom).toEqual(['c2']);
    expect(status('c2')).toBe('no-room');
  });

  it('only constraint players (no slot accepts them) is yellow', () => {
    const r = [pl('c1', 'A', ['C']), pl('w1', 'B', ['LW']), pl('d1', 'C', ['D'])];
    const { summary, status } = run(r, CL);
    expect(summary.attention).toBe('capacity');
    expect(summary.noRoom).toEqual(['d1']);
    expect(status('d1')).toBe('no-room');
  });

  it('opportunity and capacity players together: crimson takes precedence', () => {
    const r = [pl('c1', 'A', ['C']), pl('w1', 'B', ['LW']), pl('d1', 'C', ['D'])];
    const { summary, status } = run(r, CL, { 'C#0': 'c1', 'LW#0': null });
    expect(summary.attention).toBe('avoidable');
    expect(summary.opportunities).toEqual(['w1']);
    expect(summary.noRoom).toEqual(['d1']);
    expect([status('w1'), status('d1')]).toEqual(['avoidable', 'no-room']);
  });

  it('a permanently unfillable slot alone sets no indicator', () => {
    // Two goalie slots, no goalie on the roster: G stays empty every day.
    const st = expandSeats(slots({ C: ['C'], G: [2, ['G']] }));
    const r = [pl('c1', 'A', ['C'])];
    const { day, summary } = run(r, st);
    expect(day.seats.filter((x) => !x.playerId).length).toBe(2);
    expect(summary.attention).toBeNull();
  });

  it('IR players with games never set an indicator', () => {
    const r = [pl('c1', 'A', ['C']), pl('w1', 'B', ['LW']), pl('hurt', 'C', ['C'], true)];
    const { summary, status } = run(r, CL);
    expect(summary.attention).toBeNull();
    expect(status('hurt')).toBeUndefined();
    // Still none on a saved day that leaves a slot empty, if only the IR player could fill it.
    expect(run(r, CL, { 'C#0': null, 'LW#0': 'w1' }).summary.opportunities).toEqual(['c1']);
  });

  it('automatic vs saved lineups: the same roster is clear when automatic, crimson when a saved lineup benches a fitting player', () => {
    const r = [pl('c1', 'A', ['C']), pl('w1', 'B', ['LW'])];
    expect(run(r, CL).summary.attention).toBeNull();
    const saved = run(r, CL, { 'C#0': 'c1', 'LW#0': null });
    expect(saved.day.manual).toBe(true);
    expect(saved.summary.attention).toBe('avoidable');
  });

  it('day indicators agree with player statuses, and automatic days are never crimson (random rosters)', () => {
    const teams = ['A', 'B', 'C', 'D', 'E', 'F'];
    const pos: Position[][] = [['C'], ['LW'], ['RW'], ['D'], ['C', 'LW'], ['LW', 'RW'], ['G'], ['C', 'RW']];
    const full = expandSeats(slots({ C: [2, ['C']], LW: [2, ['LW']], RW: [2, ['RW']], D: [2, ['D']], UTIL: ['C', 'LW', 'RW', 'D'], G: [2, ['G']] }));
    let seed = 23;
    const rnd = (n: number) => ((seed = (seed * 9301 + 49297) % 233280), Math.floor((seed / 233280) * n));
    for (let t = 0; t < 80; t++) {
      const r: LineupPlayer[] = Array.from({ length: 6 + rnd(18) }, (_, i) => ({ ...player(`p${i}`, teams[rnd(teams.length)]!, pos[rnd(pos.length)]!, rnd(9) === 0), preferred: rnd(4) === 0 }));
      const auto = run(r, full);
      // Random saved lineup: the automatic one with some seats emptied.
      const lineup = lineupOf(auto.day);
      for (const k of Object.keys(lineup)) if (rnd(4) === 0) lineup[k] = null;
      for (const { day, summary, status } of [auto, run(r, full, lineup)]) {
        const benched = r.filter((p) => !p.onIr && !day.seats.some((x) => x.playerId === p.id) && day.players.find((x) => x.playerId === p.id)!.game);
        const st = benched.map((p) => status(p.id));
        expect(st.every((x) => x === 'avoidable' || x === 'no-room')).toBe(true);
        const want = st.includes('avoidable') ? 'avoidable' : st.length ? 'capacity' : null;
        expect(summary.attention).toBe(want);
        // Avoidable exactly when the lineup's games are below the day's maximum.
        expect(summary.attention === 'avoidable').toBe(day.usable < day.optimalUsable);
        if (!day.manual) expect(summary.attention).not.toBe('avoidable');
      }
    }
  });
});
