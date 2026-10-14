import { describe, expect, it } from 'vitest';
import { rankTeams } from './rankings.ts';
import { defaultDir, gridCell, matchupsOn, nextSort, rosterPlayersByTeam, sortTeamRows } from './teamSchedules.ts';
import { sched } from './testUtils.ts';
import type { Player } from './types.ts';

const row = (team: string, games: number, light: number) => ({ team, values: { games, light } });

describe('team table sorting', () => {
  const rows = [row('BBB', 7, 3), row('AAA', 7, 5), row('CCC', 6, 6), row('DDD', 8, 1)];

  it('numeric columns default to most-first; team defaults to A→Z', () => {
    expect(defaultDir('games')).toBe('desc');
    expect(defaultDir('light')).toBe('desc');
    expect(defaultDir('team')).toBe('asc');
  });

  it('clicking the active column reverses it; another column starts in its default direction', () => {
    let s = { key: 'games', dir: 'desc' as const };
    s = nextSort(s, 'games') as typeof s;
    expect(s).toEqual({ key: 'games', dir: 'asc' });
    expect(nextSort(s, 'games')).toEqual({ key: 'games', dir: 'desc' });
    expect(nextSort(s, 'team')).toEqual({ key: 'team', dir: 'asc' });
    expect(nextSort({ key: 'team', dir: 'asc' }, 'light')).toEqual({ key: 'light', dir: 'desc' });
  });

  it('sorts both directions with stable tie-breaks', () => {
    const desc = sortTeamRows(rows, { key: 'games', dir: 'desc' }, ['games', 'light']);
    expect(desc.map((r) => r.team)).toEqual(['DDD', 'AAA', 'BBB', 'CCC']); // AAA/BBB tie on games → more light first
    const asc = sortTeamRows(rows, { key: 'games', dir: 'asc' }, ['games', 'light']);
    expect(asc.map((r) => r.team)).toEqual(['CCC', 'AAA', 'BBB', 'DDD']); // tie-break order unchanged when reversed
    expect(sortTeamRows(rows, { key: 'team', dir: 'desc' }).map((r) => r.team)).toEqual(['DDD', 'CCC', 'BBB', 'AAA']);
    expect(sortTeamRows(rows, { key: 'light', dir: 'asc' }).map((r) => r.team)).toEqual(['DDD', 'BBB', 'AAA', 'CCC']);
  });
});

describe('round filtering', () => {
  it('counts only games inside the selected round, inclusive of its first and last day', () => {
    const s = sched([
      ['2027-03-07', 'AAA', 'BBB'], // last day of round 1
      ['2027-03-08', 'AAA', 'CCC'], // first day of round 2
      ['2027-03-09', 'BBB', 'CCC'],
    ]);
    const [r2] = [rankTeams(s, ['AAA', 'BBB', 'CCC'], [{ start: '2027-03-08', end: '2027-03-21' }])];
    expect(Object.fromEntries(r2!.map((r) => [r.team, r.total]))).toEqual({ AAA: 1, BBB: 1, CCC: 2 });
  });
});

describe('matchup details', () => {
  const s = sched([
    ['2027-03-01', 'TOR', 'MTL'],
    ['2027-03-01', 'BOS', 'NYR'],
    ['2027-03-02', 'MTL', 'TOR'],
  ]);

  it('lists every game on a date as away @ home', () => {
    expect(matchupsOn(s, '2027-03-01').map((m) => `${m.away} @ ${m.home}`)).toEqual(['MTL @ TOR', 'NYR @ BOS']);
    expect(matchupsOn(s, '2027-03-05')).toEqual([]);
  });

  it('labels grid cells by opponent, home vs away, and leaves off-days empty', () => {
    expect(gridCell(s, 'TOR', '2027-03-01')).toEqual({ label: 'MTL', home: true, opponent: 'MTL' });
    expect(gridCell(s, 'MTL', '2027-03-01')).toEqual({ label: '@TOR', home: false, opponent: 'TOR' });
    expect(gridCell(s, 'BOS', '2027-03-02')).toBeNull();
  });
});

describe('roster players by team', () => {
  const dir: Record<string, Player> = {
    a: { id: 'a', name: 'Zed Alpha', team: 'TOR', positions: ['C'], eligibilitySource: 'espn' },
    b: { id: 'b', name: 'Amy Beta', team: 'TOR', positions: ['D'], eligibilitySource: 'espn' },
    c: { id: 'c', name: 'Cal Gamma', team: 'BOS', positions: ['G'], eligibilitySource: 'nhl' },
  };
  const resolve = (id: string) => dir[id];

  it('groups by team with names and effective positions, and stays in sync with the roster', () => {
    const entries = [
      { playerId: 'a', onIr: false, positionsOverride: ['C', 'LW'] as Player['positions'] },
      { playerId: 'b', onIr: true },
      { playerId: 'c', onIr: false },
      { playerId: 'missing', onIr: false },
    ];
    const m = rosterPlayersByTeam(entries, resolve);
    expect(m.get('TOR')).toEqual([
      { id: 'b', name: 'Amy Beta', positions: ['D'], onIr: true },
      { id: 'a', name: 'Zed Alpha', positions: ['C', 'LW'], onIr: false },
    ]);
    expect(m.get('BOS')?.length).toBe(1);
    expect(m.get('NYR')).toBeUndefined(); // teams with no rostered players have no entry
    // Removing a player updates the grouping.
    expect(rosterPlayersByTeam(entries.slice(1), resolve).get('TOR')?.map((p) => p.id)).toEqual(['b']);
  });
});
