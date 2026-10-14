import { describe, expect, it } from 'vitest';
import { dailyGroupCounts, groupCapacity, sumGroupCounts } from './capacity.ts';
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

  it('sums goalie opportunities and slot-days over a round without changing usable games', () => {
    // Three goalies; Mon: 3 teams play (3/2), Tue: 1 plays (1/2), Wed: none (0/2).
    const s = sched([
      ['2027-03-01', 'AAA', 'BBB'],
      ['2027-03-01', 'CCC', 'DDD'],
      ['2027-03-02', 'AAA', 'EEE'],
    ]);
    const roster = [player('g1', 'AAA', ['G']), player('g2', 'BBB', ['G']), player('g3', 'CCC', ['G'])];
    const lineup = slots({ G: [2, ['G']] });
    const r = optimizeRange('2027-03-01', '2027-03-03', roster, { slots: lineup }, s);
    expect(r.days.map((d) => dailyGroupCounts(d, roster, lineup).goalies)).toEqual([
      { available: 3, capacity: 2 },
      { available: 1, capacity: 2 },
      { available: 0, capacity: 2 },
    ]);
    expect(sumGroupCounts(r.days, roster, lineup).goalies).toEqual({ available: 4, capacity: 6 });
    expect(r.usable).toBe(3); // 2 on Mon (one surplus) + 1 on Tue
  });
});
