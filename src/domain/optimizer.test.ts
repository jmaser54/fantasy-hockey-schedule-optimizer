import { describe, expect, it } from 'vitest';
import type { Position } from './types.ts';
import { maxBipartiteMatching } from './matching.ts';
import { canPlaySeat, canStartTogether, expandSeats, isEmptyOverride, moveInLineup, optimizeDates, optimizeDay, optimizeRange, sitPlayer, startPlayer, type DayOverride, type LineupPlayer } from './optimizer.ts';
import { player, sched, slots } from './testUtils.ts';

describe('optimizer — hand-checkable cases', () => {
  it('1. single eligible player with one compatible slot uses every game', () => {
    const s = sched([
      ['2027-03-01', 'AAA', 'BBB'],
      ['2027-03-03', 'CCC', 'AAA'],
      ['2027-03-05', 'AAA', 'DDD'],
    ]);
    const r = optimizeRange('2027-03-01', '2027-03-07', [player('p1', 'AAA', ['C'])], { slots: slots({ C: ['C'] }) }, s);
    expect(r.scheduled).toBe(3);
    expect(r.usable).toBe(3);
  });

  it('2. two players competing for one exclusive slot cannot both play the same day', () => {
    const s = sched([
      ['2027-03-01', 'AAA', 'BBB'], // both teams' players play on 03-01
    ]);
    const roster = [player('a', 'AAA', ['C']), player('b', 'BBB', ['C'])];
    const r = optimizeRange('2027-03-01', '2027-03-01', roster, { slots: slots({ C: ['C'] }) }, s);
    expect(r.scheduled).toBe(2);
    expect(r.usable).toBe(1);
    const day = r.days[0]!;
    const benched = day.players.find((p) => p.game && !p.seatKey)!;
    expect(benched.reason).toEqual({ kind: 'slots-full', slotLabels: ['C'], occupants: [expect.any(String)] });
  });

  it('3. multi-position player is placed optimally and counted once', () => {
    // Slots: C, LW. Players: X (C/LW), Y (C only). Greedy "X→C" would bench Y.
    const s = sched([['2027-03-01', 'AAA', 'BBB']]);
    const roster = [player('X', 'AAA', ['C', 'LW']), player('Y', 'BBB', ['C'])];
    const r = optimizeRange('2027-03-01', '2027-03-01', roster, { slots: slots({ C: ['C'], LW: ['LW'] }) }, s);
    expect(r.usable).toBe(2);
    const seats = Object.fromEntries(r.days[0]!.seats.map((x) => [x.seat.slotId, x.playerId]));
    expect(seats).toEqual({ C: 'Y', LW: 'X' });
    // X counted once even though eligible twice.
    expect(r.players.find((p) => p.playerId === 'X')).toEqual({ playerId: 'X', scheduled: 1, usable: 1 });
  });

  it('4. more players than slots: maximizes usable games regardless of entry order', () => {
    // Slots: C, UTIL(C/D). Players in entry order: A (C/D), B (C), C (C).
    // Only two can play. Any order must yield 2, never fewer.
    const s = sched([['2027-03-01', 'AAA', 'BBB'], ['2027-03-01', 'CCC', 'DDD']]);
    const lineup = slots({ C: ['C'], UTIL: ['C', 'D'] });
    const roster = [player('A', 'AAA', ['C', 'D']), player('B', 'BBB', ['C']), player('C', 'CCC', ['C']), player('D', 'DDD', ['D'])];
    for (const order of [roster, [...roster].reverse(), [roster[2]!, roster[0]!, roster[3]!, roster[1]!]]) {
      expect(optimizeRange('2027-03-01', '2027-03-01', order, { slots: lineup }, s).usable).toBe(2);
    }
    // Slots C + 2×D. Entered first, A (C/D) would take C under first-fit and
    // leave a D seat empty; the optimum puts A at D and B or C at C.
    const r = optimizeRange('2027-03-01', '2027-03-01', roster, { slots: slots({ C: ['C'], D: [2, ['D']] }) }, s);
    expect(r.usable).toBe(3);
    const atD = r.days[0]!.seats.filter((x) => x.seat.slotId === 'D').map((x) => x.playerId).sort();
    expect(atD).toEqual(['A', 'D']);
  });

  it('5. different daily schedules are evaluated per date', () => {
    // One C slot. A plays Mon/Wed, B plays Tue/Wed. Only Wed conflicts.
    const s = sched([
      ['2027-03-01', 'AAA', 'XXX'],
      ['2027-03-02', 'BBB', 'YYY'],
      ['2027-03-03', 'AAA', 'BBB'],
    ]);
    const roster = [player('A', 'AAA', ['C']), player('B', 'BBB', ['C'])];
    const r = optimizeRange('2027-03-01', '2027-03-03', roster, { slots: slots({ C: ['C'] }) }, s);
    expect(r.scheduled).toBe(4);
    expect(r.usable).toBe(3);
    expect(r.days.map((d) => d.usable)).toEqual([1, 1, 1]);
  });

  it('6. goalie games are counted as opportunities and reported separately', () => {
    // Team plays 2 games; two rostered goalies from the same team: both are
    // listed as opportunities, but only the slot capacity (2 G) bounds them.
    const s = sched([['2027-03-01', 'AAA', 'BBB'], ['2027-03-02', 'AAA', 'CCC']]);
    const roster = [player('G1', 'AAA', ['G']), player('G2', 'AAA', ['G']), player('S', 'BBB', ['C'])];
    const r = optimizeRange('2027-03-01', '2027-03-02', roster, { slots: slots({ C: ['C'], G: [2, ['G']] }) }, s);
    expect(r.usable).toBe(5);
    expect(r.goalieUsable).toBe(4);
    const one = optimizeRange('2027-03-01', '2027-03-02', roster, { slots: slots({ C: ['C'], G: [1, ['G']] }) }, s);
    expect(one.goalieUsable).toBe(2); // one goalie opportunity per day with one G slot
  });

  it('7. IR players never occupy active slots or add capacity', () => {
    const s = sched([['2027-03-01', 'AAA', 'BBB']]);
    const roster = [player('A', 'AAA', ['C']), player('B', 'BBB', ['C'], true)];
    const r = optimizeRange('2027-03-01', '2027-03-01', roster, { slots: slots({ C: [2, ['C']] }) }, s);
    expect(r.scheduled).toBe(1); // IR player's game is not a lineup option
    expect(r.usable).toBe(1);
    const ir = r.days[0]!.players.find((p) => p.playerId === 'B')!;
    expect(ir.seatKey).toBeUndefined();
    expect(ir.reason).toEqual({ kind: 'ir' });
  });

  it('8. period boundaries are inclusive on both ends', () => {
    const s = sched([
      ['2027-02-21', 'AAA', 'BBB'], // day before
      ['2027-02-22', 'AAA', 'BBB'], // first day
      ['2027-03-07', 'AAA', 'BBB'], // last day
      ['2027-03-08', 'AAA', 'BBB'], // day after
    ]);
    const r = optimizeRange('2027-02-22', '2027-03-07', [player('A', 'AAA', ['C'])], { slots: slots({ C: ['C'] }) }, s);
    expect(r.days[0]!.date).toBe('2027-02-22');
    expect(r.days.at(-1)!.date).toBe('2027-03-07');
    expect(r.days).toHaveLength(14);
    expect(r.usable).toBe(2);
  });

  it('9. traded player uses the right team per date and is never double counted', () => {
    // Old team AAA plays 03-01, 03-03 (also after trade), 03-05.
    // New team BBB plays 03-02, 03-03, 03-06. Trade effective 03-03.
    const s = sched([
      ['2027-03-01', 'AAA', 'XXX'],
      ['2027-03-02', 'BBB', 'YYY'],
      ['2027-03-03', 'AAA', 'ZZZ'],
      ['2027-03-03', 'BBB', 'WWW'],
      ['2027-03-05', 'AAA', 'XXX'],
      ['2027-03-06', 'BBB', 'YYY'],
    ]);
    const traded = {
      ...player('T', 'BBB', ['C']),
      stints: [
        { team: 'AAA', to: '2027-03-02' },
        { team: 'BBB', from: '2027-03-03' },
      ],
    };
    const r = optimizeRange('2027-03-01', '2027-03-07', [traded], { slots: slots({ C: [2, ['C']] }) }, s);
    // 03-01 (AAA), 03-03 (BBB only — one game), 03-06 (BBB) = 3
    expect(r.scheduled).toBe(3);
    expect(r.days.filter((d) => d.scheduled).map((d) => d.date)).toEqual(['2027-03-01', '2027-03-03', '2027-03-06']);
  });

  it('10. a daily choice changes the lineup and reset restores the optimum', () => {
    const s = sched([['2027-03-01', 'AAA', 'BBB']]);
    // X can play C or LW, Y only C, W only LW (same team as Y). Optimum: 2 of 3.
    const roster = [player('X', 'AAA', ['C', 'LW']), player('Y', 'BBB', ['C']), player('W', 'BBB', ['LW'])];
    const league = { slots: slots({ C: ['C'], LW: ['LW'] }) };
    const opt = optimizeRange('2027-03-01', '2027-03-01', roster, league, s);
    expect(opt.usable).toBe(2);
    expect(opt.manualDays).toBe(0);

    // Sitting Y: the optimizer refills around the choice (X and W still fill both spots).
    const sat = optimizeRange('2027-03-01', '2027-03-01', roster, league, s, { '2027-03-01': sitPlayer(undefined, 'Y') });
    expect(sat.usable).toBe(2);
    const y = sat.days[0]!.players.find((p) => p.playerId === 'Y')!;
    expect(y.seatKey).toBeUndefined();
    expect(y).toMatchObject({ choice: 'sit', reason: { kind: 'sat' } });
    expect(sat.manualDays).toBe(1);

    // Sitting X and W leaves LW empty: the user's choice wins, and the optimum is still reported.
    const worse = optimizeRange('2027-03-01', '2027-03-01', roster, league, s, { '2027-03-01': { start: [], sit: ['X', 'W'] } });
    expect(worse.usable).toBe(1);
    expect(worse.optimalUsable).toBe(2);

    // Reset = drop the date's choices.
    const reset = optimizeRange('2027-03-01', '2027-03-01', roster, league, s, {});
    expect(reset.usable).toBe(2);
    expect(reset.manualDays).toBe(0);
  });

  it('daily starts that cannot be honored are ignored and reported, never forced into an invalid lineup', () => {
    const s = sched([['2027-03-01', 'AAA', 'BBB']]);
    const roster = [player('X', 'AAA', ['D']), player('Y', 'BBB', ['C'], true), player('Z', 'CCC', ['C']), player('V', 'AAA', ['C']), player('U', 'BBB', ['C'])];
    const seats = expandSeats(slots({ C: ['C'] }));
    const day = optimizeDay('2027-03-01', roster, seats, s, { start: ['X', 'Y', 'Z', 'V', 'U', 'gone'], sit: [] });
    // X: no C slot. Y: on IR. gone: not on roster. U and Z: the one C seat already holds V
    // (started players with a game are seated before started players without one).
    expect(day.manualIssues).toHaveLength(5);
    expect(day.manualIssues.join(' ')).toMatch(/IR/);
    expect(day.seats.map((x) => x.playerId)).toEqual(['V']);
    expect(day.usable).toBe(1);
    expect(canStartTogether([roster[3]!, roster[4]!], seats)).toBe(false);
  });

  it('a started player without a game takes the seat: the user’s call, even though it loses a game', () => {
    const s = sched([['2027-03-01', 'AAA', 'BBB']]);
    const roster = [player('V', 'AAA', ['C']), player('Z', 'CCC', ['C'])];
    const seats = expandSeats(slots({ C: ['C'] }));
    expect(optimizeDay('2027-03-01', roster, seats, s).seats.map((x) => x.playerId)).toEqual(['V']);
    const day = optimizeDay('2027-03-01', roster, seats, s, { start: ['Z'], sit: ['V'] });
    expect(day.seats.map((x) => x.playerId)).toEqual(['Z']);
    expect(day.usable).toBe(0);
    expect(day.optimalUsable).toBe(1);
    expect(day.manualIssues).toEqual([]);
  });

  it('reports players with no compatible slot', () => {
    const s = sched([['2027-03-01', 'AAA', 'BBB']]);
    const r = optimizeDay('2027-03-01', [player('G', 'AAA', ['G'])], expandSeats(slots({ C: ['C'] })), s);
    expect(r.players[0]!.reason).toEqual({ kind: 'no-slot', positions: ['G'] });
  });
});

describe('matching — brute-force cross-check', () => {
  function bruteForce(adj: number[][], right: number): number {
    let best = 0;
    const used = new Array(right).fill(false);
    const go = (u: number, size: number) => {
      if (u === adj.length) {
        best = Math.max(best, size);
        return;
      }
      if (size + (adj.length - u) <= best) return;
      go(u + 1, size);
      for (const v of adj[u]!) {
        if (used[v]) continue;
        used[v] = true;
        go(u + 1, size + 1);
        used[v] = false;
      }
    };
    go(0, 0);
    return best;
  }

  it('matches exhaustive search on 500 random small instances', () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let t = 0; t < 500; t++) {
      const L = 1 + Math.floor(rand() * 8);
      const R = 1 + Math.floor(rand() * 7);
      const adj = Array.from({ length: L }, () => [...Array(R).keys()].filter(() => rand() < 0.35));
      const res = maxBipartiteMatching(L, R, adj);
      expect(res.size).toBe(bruteForce(adj, R));
      // Matching is valid: each pair is an edge, no seat reused.
      const seen = new Set<number>();
      res.leftToRight.forEach((v, u) => {
        if (v === -1) return;
        expect(adj[u]).toContain(v);
        expect(seen.has(v)).toBe(false);
        seen.add(v);
      });
    }
  });
});

describe('player priorities and daily choices', () => {
  const s = sched([
    ['2027-03-01', 'AAA', 'BBB'],
    ['2027-03-01', 'CCC', 'DDD'],
    ['2027-03-02', 'AAA', 'BBB'],
    ['2027-03-02', 'CCC', 'DDD'],
    ['2027-03-03', 'AAA', 'BBB'],
    ['2027-03-03', 'CCC', 'DDD'],
  ]);
  const league = { slots: slots({ C: [2, ['C']], UTIL: [1, ['C', 'LW', 'RW', 'D']], G: [1, ['G']] }) };
  const dates = ['2027-03-01', '2027-03-02', '2027-03-03'];
  const base = (): LineupPlayer[] => [
    player('c1', 'AAA', ['C']),
    player('c2', 'BBB', ['C']),
    player('c3', 'CCC', ['C']),
    player('c4', 'DDD', ['C']), // four Cs for three C-capable spots
    player('g1', 'AAA', ['G']),
    player('g2', 'CCC', ['G']), // two goalies for one G spot
  ];
  const seatedOn = (days: Map<string, ReturnType<typeof optimizeDay>>, d: string) =>
    days
      .get(d)!
      .seats.map((x) => x.playerId)
      .filter(Boolean)
      .sort();
  const prefer = (roster: LineupPlayer[], ...ids: string[]) => roster.map((p) => (ids.includes(p.id) ? { ...p, preferred: true } : p));

  it('a preferred player wins a contested spot over a lower-priority player, on every date', () => {
    const plain = optimizeDates(dates, base(), league, s);
    for (const d of dates) expect(seatedOn(plain, d)).toEqual(['c1', 'c2', 'c3', 'g1']); // roster order
    const pref = optimizeDates(dates, prefer(base(), 'c4', 'g2'), league, s);
    for (const d of dates) expect(seatedOn(pref, d)).toEqual(['c1', 'c2', 'c4', 'g2']);
  });

  it('priorities never break eligibility or capacity, and never cost a filled spot (random cross-check)', () => {
    let seed = 99;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const POS = ['C', 'LW', 'RW', 'D', 'G'] as const;
    const teams = ['AAA', 'BBB', 'CCC', 'DDD'];
    for (let t = 0; t < 300; t++) {
      const roster = Array.from({ length: 4 + Math.floor(rand() * 10) }, (_, i) => {
        const pos = POS.filter(() => rand() < 0.3);
        return { ...player(`p${i}`, teams[Math.floor(rand() * 4)]!, pos.length ? [...pos] : ['C']), preferred: rand() < 0.4 };
      });
      const lg = { slots: slots({ C: [1 + Math.floor(rand() * 2), ['C']], W: [1, ['LW', 'RW']], D: [1, ['D']], U: [1, ['C', 'LW', 'RW', 'D']], G: [1, ['G']] }) };
      const day = optimizeDay('2027-03-01', roster, expandSeats(lg.slots), s);
      const unprioritized = optimizeDay('2027-03-01', roster.map((p) => ({ ...p, preferred: false })), expandSeats(lg.slots), s);
      // Same number of filled spots as without priorities (the maximum).
      expect(day.usable).toBe(unprioritized.usable);
      expect(day.usable).toBe(day.optimalUsable);
      // Every seated player has a game, fits the seat, and appears once.
      const ids = day.seats.flatMap((x) => (x.playerId ? [x.playerId] : []));
      expect(new Set(ids).size).toBe(ids.length);
      for (const { seat, playerId } of day.seats) {
        if (!playerId) continue;
        const p = roster.find((r) => r.id === playerId)!;
        expect(p.positions.some((x) => seat.accepts.includes(x))).toBe(true);
        expect(day.players.find((x) => x.playerId === playerId)!.game).toBeDefined();
      }
      // At least as many preferred players seated as without priorities.
      const prefCount = (d: typeof day) => d.seats.filter((x) => x.playerId && roster.find((r) => r.id === x.playerId)!.preferred).length;
      expect(prefCount(day)).toBeGreaterThanOrEqual(prefCount(unprioritized));
    }
  });

  it('starting a player bumps the lowest-priority competitor and fills the rest automatically', () => {
    const roster = prefer(base(), 'c1');
    const days = optimizeDates(dates, roster, league, s, { '2027-03-01': startPlayer(undefined, 'c4') });
    // c4 is in; c1 (preferred) and c2 keep their spots; c3 is the lowest-priority C, so c3 sits.
    expect(seatedOn(days, '2027-03-01')).toEqual(['c1', 'c2', 'c4', 'g1']);
    expect(days.get('2027-03-01')!.players.find((p) => p.playerId === 'c4')!.choice).toBe('start');
    expect(days.get('2027-03-01')!.manual).toBe(true);
    expect(days.get('2027-03-02')!.manual).toBe(false);
  });

  it('a choice on one date is kept when another date is edited, and other dates are unaffected', () => {
    let manual: Record<string, DayOverride> = { '2027-03-01': startPlayer(undefined, 'c4') };
    const first = optimizeDates(dates, base(), league, s, manual);
    manual = { ...manual, '2027-03-02': sitPlayer(manual['2027-03-02'], 'g1') };
    const second = optimizeDates(dates, base(), league, s, manual);
    expect(seatedOn(second, '2027-03-01')).toEqual(seatedOn(first, '2027-03-01'));
    expect(seatedOn(second, '2027-03-01')).toContain('c4');
    expect(seatedOn(second, '2027-03-02')).toEqual(['c1', 'c2', 'c3', 'g2']);
    expect(seatedOn(second, '2027-03-03')).toEqual(seatedOn(first, '2027-03-03'));
  });

  it('changing priorities updates automatic dates but keeps manual choices', () => {
    const manual = { '2027-03-01': { start: ['c3'], sit: ['c1'] } };
    const before = optimizeDates(dates, base(), league, s, manual);
    expect(seatedOn(before, '2027-03-01')).toEqual(['c2', 'c3', 'c4', 'g1']);
    const after = optimizeDates(dates, prefer(base(), 'c1', 'g2'), league, s, manual);
    // Manual date: c3 still started, c1 still sat (despite now being preferred); the free spot and G follow priorities.
    expect(seatedOn(after, '2027-03-01')).toEqual(['c2', 'c3', 'c4', 'g2']);
    // Automatic dates follow the new priorities.
    expect(seatedOn(after, '2027-03-02')).toEqual(['c1', 'c2', 'c3', 'g2']);
  });

  it('resetting a date restores its priority-aware optimized lineup', () => {
    const roster = prefer(base(), 'c4');
    const edited = optimizeDates(dates, roster, league, s, { '2027-03-01': sitPlayer(undefined, 'c4') });
    expect(seatedOn(edited, '2027-03-01')).not.toContain('c4');
    const reset = optimizeDates(dates, roster, league, s, {});
    expect(seatedOn(reset, '2027-03-01')).toEqual(seatedOn(reset, '2027-03-02'));
    expect(seatedOn(reset, '2027-03-01')).toContain('c4');
  });

  it('player and overall counts match the final lineups, including daily choices, for skaters and goalies', () => {
    const roster = [...prefer(base(), 'g2'), player('irC', 'BBB', ['C'], true)];
    const manual = { '2027-03-01': { start: ['c4', 'g1'], sit: [] }, '2027-03-02': { start: [], sit: ['c2'] } };
    const r = optimizeRange('2027-03-01', '2027-03-03', roster, league, s, manual);
    const seatedCount = (id: string) => r.days.filter((d) => d.seats.some((x) => x.playerId === id)).length;
    for (const t of r.players) {
      expect(t.usable).toBe(seatedCount(t.playerId));
      expect(t.scheduled).toBe(3); // every team here plays all three dates
    }
    expect(r.players.find((p) => p.playerId === 'g1')!.usable).toBe(1); // started on 03-01 only
    expect(r.players.find((p) => p.playerId === 'g2')!.usable).toBe(2); // preferred on the other dates
    expect(r.players.find((p) => p.playerId === 'irC')!.usable).toBe(0);
    expect(r.usable).toBe(r.days.reduce((n, d) => n + d.seats.filter((x) => x.playerId).length, 0));
    expect(r.goalieUsable).toBe(3);
  });
});

describe('exact daily lineups (day editor moves)', () => {
  const s = sched([['2027-03-01', 'AAA', 'BBB']]);
  const roster = [player('C1', 'AAA', ['C']), player('C2', 'BBB', ['C']), player('C3', 'CCC', ['C']), player('G1', 'AAA', ['G']), player('G2', 'BBB', ['G'])];
  const seats = expandSeats(slots({ C: ['C'], UTIL: ['C', 'LW', 'RW', 'D'], G: [2, ['G']] }));
  const auto = optimizeDay('2027-03-01', roster, seats, s);
  const lineupOf = (d: ReturnType<typeof optimizeDay>) => Object.fromEntries(d.seats.map((x) => [x.seat.key, x.playerId ?? null]));

  it('is used exactly: only the moved players change, nothing refills', () => {
    const before = lineupOf(auto);
    expect(Object.values(before).sort()).toEqual(['C1', 'C2', 'G1', 'G2']);
    // Swap the C-slot player with C3 (no game), and move the goalie in G#1 to the bench.
    const lineup = { ...before, 'C#0': 'C3', 'G#1': null };
    const day = optimizeDay('2027-03-01', roster, seats, s, { start: [], sit: [], lineup });
    expect(lineupOf(day)).toEqual(lineup);
    expect(day.usable).toBe(2); // C2 and G1; C3 has no game, G2's seat stays empty
    expect(day.optimalUsable).toBe(4);
    expect(day.manual).toBe(true);
    expect(day.manualIssues).toEqual([]);
  });

  it('keeps goalies and skaters apart, strictly per slot', () => {
    const [c, , , g] = roster;
    const seat = (key: string) => seats.find((x) => x.key === key)!;
    expect(canPlaySeat(g!, seat('UTIL#0'))).toBe(false);
    expect(canPlaySeat(g!, seat('C#0'))).toBe(false);
    expect(canPlaySeat(c!, seat('G#0'))).toBe(false);
    expect(canPlaySeat(c!, seat('UTIL#0'))).toBe(true);
    expect(canPlaySeat({ positions: ['G'] }, { accepts: ['C', 'G'] })).toBe(false); // a slot that takes skaters never takes a goalie
    const day = optimizeDay('2027-03-01', roster, seats, s, { start: [], sit: [], lineup: { 'C#0': 'C1', 'UTIL#0': 'G2', 'G#0': 'C2', 'G#1': 'G1' } });
    expect(lineupOf(day)).toEqual({ 'C#0': 'C1', 'UTIL#0': null, 'G#0': null, 'G#1': 'G1' });
    expect(day.manualIssues).toHaveLength(2);
  });

  it('is ignored, visibly, when the league’s slots changed', () => {
    const day = optimizeDay('2027-03-01', roster, seats, s, { start: [], sit: [], lineup: { 'C#0': 'C3', 'G#0': null } });
    expect(lineupOf(day)).toEqual(lineupOf(auto));
    expect(day.manualIssues.join(' ')).toMatch(/slots changed/);
  });

  it('counts as a manual change even with every seat empty', () => {
    expect(isEmptyOverride({ start: [], sit: [], lineup: { 'C#0': null } })).toBe(false);
  });
});

describe('lineup slot order', () => {
  it('puts F slots first and goalie slots last, keeping every other slot (UTIL included) in league order', () => {
    const order = expandSeats([
      ...slots({ C: ['C'], LW: ['LW'], D: ['D'], UTIL: ['C', 'LW', 'RW', 'D'], G: [2, ['G']] }),
      { id: 'F', label: 'F', count: 2, accepts: ['C', 'LW', 'RW'] }, // added after G, as League Settings' "Add Slot" does
    ]).map((x) => x.label);
    expect(order).toEqual(['F', 'F', 'C', 'LW', 'D', 'UTIL', 'G', 'G']);
  });

  it('leaves a league without F slots in its own order (goalies last)', () => {
    expect(expandSeats(slots({ G: ['G'], C: ['C'], UTIL: ['C', 'LW', 'RW', 'D'] })).map((x) => x.label)).toEqual(['C', 'UTIL', 'G']);
  });
});

describe('day editor moves (moveInLineup)', () => {
  const seats = expandSeats(slots({ C: ['C'], LW: ['LW'], UTIL: ['C', 'LW', 'RW', 'D'], G: [2, ['G']] }));
  const ps = new Map([
    ['c1', { positions: ['C'] as Position[] }],
    ['c2', { positions: ['C'] as Position[] }],
    ['lw', { positions: ['LW'] as Position[] }],
    ['d', { positions: ['D'] as Position[] }],
    ['g1', { positions: ['G'] as Position[] }],
    ['g2', { positions: ['G'] as Position[] }],
  ]);
  const base = { 'C#0': 'c1', 'LW#0': 'lw', 'UTIL#0': 'd', 'G#0': 'g1', 'G#1': null };

  it('swaps a starter with a bench player: only those two change', () => {
    expect(moveInLineup(base, seats, ps, 'c1', undefined, 'c2')).toEqual({ ...base, 'C#0': 'c2' });
    expect(moveInLineup(base, seats, ps, 'c2', 'C#0', 'c1')).toEqual({ ...base, 'C#0': 'c2' }); // from the bench side
  });

  it('swaps two starters only when each can play the other’s slot', () => {
    expect(moveInLineup(base, seats, ps, 'c1', 'UTIL#0', 'd')).toBeNull(); // d can't play C
    expect(moveInLineup({ ...base, 'UTIL#0': 'c2' }, seats, ps, 'c1', 'UTIL#0', 'c2')).toEqual({ ...base, 'C#0': 'c2', 'UTIL#0': 'c1' });
  });

  it('moves into an empty slot and leaves the old one empty', () => {
    expect(moveInLineup(base, seats, ps, 'g1', 'G#1', undefined)).toEqual({ ...base, 'G#0': null, 'G#1': 'g1' });
    expect(moveInLineup(base, seats, ps, 'g2', 'G#1', undefined)).toEqual({ ...base, 'G#1': 'g2' });
    expect(moveInLineup(base, seats, ps, 'lw', undefined, undefined)).toEqual({ ...base, 'LW#0': null }); // to the bench
  });

  it('never moves a goalie into a skater slot or a skater into a goalie slot', () => {
    expect(moveInLineup(base, seats, ps, 'g2', 'UTIL#0', 'd')).toBeNull();
    expect(moveInLineup(base, seats, ps, 'g1', 'C#0', 'c1')).toBeNull();
    expect(moveInLineup(base, seats, ps, 'c2', 'G#1', undefined)).toBeNull();
    expect(moveInLineup(base, seats, ps, 'g1', undefined, 'c2')).toBeNull(); // c2 can't take g1's G slot
  });

  it('rejects a stale target and bench-to-bench moves', () => {
    expect(moveInLineup(base, seats, ps, 'c2', 'C#0', 'lw')).toBeNull(); // C#0 holds c1, not lw
    expect(moveInLineup(base, seats, ps, 'c2', undefined, 'g2')).toBeNull();
  });

  it('result is honored exactly by the optimizer', () => {
    const s = sched([['2027-03-01', 'AAA', 'BBB']]);
    const roster = [player('c1', 'AAA', ['C']), player('c2', 'CCC', ['C']), player('g1', 'BBB', ['G'])];
    const seats2 = expandSeats(slots({ C: ['C'], G: ['G'] }));
    const lineup = moveInLineup({ 'C#0': 'c1', 'G#0': 'g1' }, seats2, new Map(roster.map((p) => [p.id, p])), 'c1', undefined, 'c2')!;
    const day = optimizeDay('2027-03-01', roster, seats2, s, { start: [], sit: [], lineup });
    expect(day.seats.map((x) => x.playerId)).toEqual(['c2', 'g1']);
    expect(day.usable).toBe(1); // c2 has no game: the user's call
  });
});

describe('automatic lineup with an F slot shown first', () => {
  it('fills a player’s own slot before a flexible one', () => {
    const s = sched([['2027-03-01', 'AAA', 'BBB']]);
    const seats = expandSeats([...slots({ C: ['C'], LW: ['LW'], G: ['G'] }), { id: 'F', label: 'F', count: 1, accepts: ['C', 'LW', 'RW'] }]);
    expect(seats.map((x) => x.label)).toEqual(['F', 'C', 'LW', 'G']);
    const day = optimizeDay('2027-03-01', [player('lw', 'AAA', ['LW']), player('c', 'BBB', ['C'])], seats, s);
    expect(Object.fromEntries(day.seats.map((x) => [x.seat.label, x.playerId ?? null]))).toEqual({ F: null, C: 'c', LW: 'lw', G: null });
  });
});
