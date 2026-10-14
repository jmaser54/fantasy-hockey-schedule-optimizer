import { describe, expect, it } from 'vitest';
import { maxBipartiteMatching } from './matching.ts';
import { expandSeats, lineupFromDay, moveInLineup, optimizeDay, optimizeRange } from './optimizer.ts';
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

  it('10. manual override changes the lineup and reset restores the optimum', () => {
    const s = sched([['2027-03-01', 'AAA', 'BBB']]);
    const roster = [player('X', 'AAA', ['C', 'LW']), player('Y', 'BBB', ['C']), player('Z', 'CCC', ['LW'])];
    const league = { slots: slots({ C: ['C'], LW: ['LW'] }) };
    const seats = expandSeats(league.slots);
    const opt = optimizeRange('2027-03-01', '2027-03-01', roster, league, s);
    expect(opt.usable).toBe(2);

    // Put X into C (bumping Y), then idle Z (no game) into LW: a worse lineup.
    let manual = lineupFromDay(opt.days[0]!);
    manual = moveInLineup(manual, 'X', seats[0]!, seats, roster);
    manual = moveInLineup(manual, 'Z', seats[1]!, seats, roster);
    const edited = optimizeRange('2027-03-01', '2027-03-01', roster, league, s, { '2027-03-01': manual });
    expect(edited.usable).toBe(1);
    expect(edited.optimalUsable).toBe(2);
    expect(edited.manualDays).toBe(1);

    // Reset = drop the override.
    const reset = optimizeRange('2027-03-01', '2027-03-01', roster, league, s, {});
    expect(reset.usable).toBe(2);
    expect(reset.manualDays).toBe(0);
  });

  it('manual lineups reject ineligible or IR placements', () => {
    const s = sched([['2027-03-01', 'AAA', 'BBB']]);
    const roster = [player('X', 'AAA', ['D']), player('Y', 'BBB', ['C'], true)];
    const seats = expandSeats(slots({ C: ['C'] }));
    const day = optimizeDay('2027-03-01', roster, seats, s, { 'C#0': 'X' });
    expect(day.usable).toBe(0);
    expect(day.manualIssues).toHaveLength(1);
    const day2 = optimizeDay('2027-03-01', roster, seats, s, { 'C#0': 'Y' });
    expect(day2.manualIssues[0]).toMatch(/IR/);
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
