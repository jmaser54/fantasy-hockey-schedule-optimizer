import { describe, expect, it } from 'vitest';
import { dailyGroupCounts, groupCapacity, lineupGroupTotals } from './capacity.ts';
import { DEFAULT_SLOTS } from './league.ts';
import { expandSeats, optimizeDay, optimizeRange } from './optimizer.ts';
import { player, sched, slots } from './testUtils.ts';

describe('lineup capacity counts', () => {
  it('reads capacity from the configured slots, not fixed numbers', () => {
    expect(groupCapacity(DEFAULT_SLOTS)).toEqual({ skaters: 11, goalies: 2 }); // 2C 2LW 2RW 4D 1UTIL | 2G
    expect(groupCapacity(slots({ F: [3, ['C', 'LW', 'RW']], D: [2, ['D']], G: [1, ['G']] }))).toEqual({ skaters: 5, goalies: 1 });
    // A custom slot that can hold either group counts toward both.
    expect(groupCapacity(slots({ C: ['C'], ANY: ['C', 'G'] }))).toEqual({ skaters: 2, goalies: 1 });
  });

  it('counts each player once per group, excluding IR and players without a game', () => {
    const s = sched([
      ['2027-03-01', 'AAA', 'BBB'],
      ['2027-03-01', 'CCC', 'DDD'],
    ]);
    const roster = [
      player('dual', 'AAA', ['C', 'LW']), // multi-position skater: counted once
      player('d', 'BBB', ['D']),
      player('ir', 'CCC', ['RW'], true), // on IR: excluded
      player('idle', 'EEE', ['C']), // no game: excluded
      player('g1', 'DDD', ['G']),
      player('g2', 'EEE', ['G']), // no game
    ];
    const day = optimizeDay('2027-03-01', roster, expandSeats(DEFAULT_SLOTS), s);
    expect(dailyGroupCounts(day, roster, DEFAULT_SLOTS)).toEqual({
      skaters: { available: 2, capacity: 11 },
      goalies: { available: 1, capacity: 2 },
    });
  });

  it('can exceed capacity (more players with games than slots) and does not alter the lineup', () => {
    const s = sched([['2027-03-01', 'AAA', 'BBB']]);
    const roster = [player('a', 'AAA', ['C']), player('b', 'BBB', ['C']), player('c', 'AAA', ['C'])];
    const lineup = slots({ C: ['C'] });
    const day = optimizeDay('2027-03-01', roster, expandSeats(lineup), s);
    expect(dailyGroupCounts(day, roster, lineup).skaters).toEqual({ available: 3, capacity: 1 });
    expect(day.usable).toBe(1);
  });

  describe('period summary (lineupGroupTotals)', () => {
    // Mon: 3 goalies + 3 C play; Tue: 1 goalie + 2 C play; Wed: nobody plays.
    const s = sched([
      ['2027-03-01', 'AAA', 'BBB'],
      ['2027-03-01', 'CCC', 'DDD'],
      ['2027-03-02', 'AAA', 'EEE'],
      ['2027-03-02', 'DDD', 'FFF'],
    ]);
    const lineup = slots({ C: [2, ['C']], G: [2, ['G']] });
    const roster = [
      player('g1', 'AAA', ['G']),
      player('g2', 'BBB', ['G']),
      player('g3', 'CCC', ['G']), // benched Mon: only 2 G seats
      player('c1', 'AAA', ['C']),
      player('c2', 'DDD', ['C']),
      player('c3', 'BBB', ['C']), // has a game Mon but doesn't fit
      player('cIr', 'AAA', ['C'], true), // IR: games scheduled, never in lineup
      player('gIr', 'CCC', ['G'], true),
    ];
    const r = optimizeRange('2027-03-01', '2027-03-03', roster, { slots: lineup }, s);
    const byId = new Map(roster.map((p) => [p.id, p]));
    const seated = (pred: (id: string) => boolean) =>
      r.days.reduce((n, d) => n + d.players.filter((st) => st.game && st.seatKey && pred(st.playerId)).length, 0);
    const rows = (pred: (id: string) => boolean) => r.players.filter((t) => pred(t.playerId));
    const goalie = (id: string) => !byId.get(id)!.onIr && byId.get(id)!.positions.every((x) => x === 'G');
    const skater = (id: string) => !byId.get(id)!.onIr && !goalie(id);

    it('goalie line = games goalies were seated / goalie games scheduled, matching the goalie rows', () => {
      const g = lineupGroupTotals(r.players, roster).goalies;
      // g1 2/2, g2 1/1, g3 1/1 (Mon: three goalies for two seats, so one is benched; Tue: g1 only).
      expect(g).toEqual({ inLineup: 3, scheduled: 4 });
      expect(g.inLineup).toBe(seated(goalie));
      expect(g.inLineup).toBe(r.goalieUsable);
      expect(g).toEqual({
        inLineup: rows(goalie).reduce((n, t) => n + t.usable, 0),
        scheduled: rows(goalie).reduce((n, t) => n + t.scheduled, 0),
      });
      // Not goalie opportunities over goalie slot-days (what the card used to show: 4/6).
      expect(g).not.toEqual({ inLineup: 4, scheduled: 6 });
    });

    it('skater line reconciles with skater rows and daily seats, including a skater who does not fit', () => {
      const sk = lineupGroupTotals(r.players, roster).skaters;
      // Mon: c1, c2, c3 for two C seats; Tue: c1, c2.
      expect(sk).toEqual({ inLineup: 4, scheduled: 5 });
      expect(sk.inLineup).toBe(seated(skater));
      expect(sk).toEqual({
        inLineup: rows(skater).reduce((n, t) => n + t.usable, 0),
        scheduled: rows(skater).reduce((n, t) => n + t.scheduled, 0),
      });
    });

    it('leaves IR players out of both groups, and the total equals the daily In Lineup / Your Games counts', () => {
      const t = lineupGroupTotals(r.players, roster);
      expect(r.players.find((p) => p.playerId === 'cIr')).toMatchObject({ usable: 0, scheduled: 2 });
      expect(t.all).toEqual({ inLineup: t.skaters.inLineup + t.goalies.inLineup, scheduled: t.skaters.scheduled + t.goalies.scheduled });
      expect(t.all).toEqual({ inLineup: r.usable, scheduled: r.scheduled });
      expect(t.all).toEqual({ inLineup: r.days.reduce((n, d) => n + d.usable, 0), scheduled: r.days.reduce((n, d) => n + d.scheduled, 0) });
      // No double counting: the summary never exceeds the lineup seats actually filled.
      expect(t.all.inLineup).toBeLessThanOrEqual(r.days.length * 4);
    });

    it('updates with the date range and the roster', () => {
      const tue = optimizeRange('2027-03-02', '2027-03-02', roster, { slots: lineup }, s);
      expect(lineupGroupTotals(tue.players, roster)).toMatchObject({ skaters: { inLineup: 2, scheduled: 2 }, goalies: { inLineup: 1, scheduled: 1 } });
      const smaller = roster.filter((p) => p.id !== 'g3');
      const r2 = optimizeRange('2027-03-01', '2027-03-03', smaller, { slots: lineup }, s);
      expect(lineupGroupTotals(r2.players, smaller).goalies).toEqual({ inLineup: 3, scheduled: 3 });
    });
  });
});
