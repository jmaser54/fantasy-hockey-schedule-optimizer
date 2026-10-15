import { describe, expect, it } from 'vitest';
import { addDays, dayCount, eachDate, easternDateFromUTC, formatRange, isValidISODate, weekday } from './dates.ts';
import { DEFAULT_LEAGUE, DEFAULT_PERIODS, validateLeague, validatePeriod } from './league.ts';
import { isLightNight, rankTeams } from './rankings.ts';
import { validateRoster } from './roster.ts';
import { playerGames } from './schedule.ts';
import { sched } from './testUtils.ts';
import type { Player, RosterEntry } from './types.ts';

describe('dates', () => {
  it('validates real calendar dates only', () => {
    expect(isValidISODate('2027-02-28')).toBe(true);
    expect(isValidISODate('2027-02-29')).toBe(false); // 2027 is not a leap year
    expect(isValidISODate('2027-2-1')).toBe(false);
  });

  it('enumerates inclusive ranges across month ends and DST changes', () => {
    // US DST begins 2027-03-14; pure date math must not skip or repeat a day.
    const days = eachDate('2027-03-13', '2027-03-15');
    expect(days).toEqual(['2027-03-13', '2027-03-14', '2027-03-15']);
    expect(eachDate('2027-02-27', '2027-03-01')).toEqual(['2027-02-27', '2027-02-28', '2027-03-01']);
    expect(addDays('2027-03-07', 1)).toBe('2027-03-08');
    expect(eachDate('2027-03-02', '2027-03-01')).toEqual([]);
  });

  it('default rounds are contiguous, 14 days each, and start on Mondays', () => {
    DEFAULT_PERIODS.forEach((p, i) => {
      expect(validatePeriod(p)).toBeNull();
      expect(dayCount(p.start, p.end)).toBe(14);
      expect(weekday(p.start)).toBe('Mon');
      if (i > 0) expect(addDays(DEFAULT_PERIODS[i - 1]!.end, 1)).toBe(p.start);
    });
  });

  it('converts a late-night UTC start to the Eastern game date', () => {
    // 10:30pm EST on Mar 1 = 03:30Z on Mar 2.
    expect(easternDateFromUTC('2027-03-02T03:30:00Z', '-05:00')).toBe('2027-03-01');
    // After DST: 10:30pm EDT on Mar 20 = 02:30Z Mar 21.
    expect(easternDateFromUTC('2027-03-21T02:30:00Z', '-04:00')).toBe('2027-03-20');
  });

  it('formats ranges', () => {
    expect(formatRange('2027-02-22', '2027-03-07')).toBe('Feb 22 – Mar 7, 2027');
  });
});

describe('league + roster validation', () => {
  const mk = (id: string, injury?: string): Player => ({
    id,
    name: id,
    team: 'AAA',
    positions: ['C'],
    eligibilitySource: 'nhl',
    injuryStatus: injury,
  });

  it('default league is valid and reads limits from config', () => {
    expect(validateLeague(DEFAULT_LEAGUE)).toEqual([]);
    expect(validateLeague({ ...DEFAULT_LEAGUE, rosterSize: 5 })).toContain('Active lineup slots exceed roster size.');
  });

  it('7. IR slots are in addition to roster size and do not raise it', () => {
    const players = new Map<string, Player>();
    const entries: RosterEntry[] = [];
    for (let i = 0; i < 22; i++) {
      players.set(`p${i}`, mk(`p${i}`));
      entries.push({ playerId: `p${i}`, onIr: false });
    }
    players.set('ir1', mk('ir1', 'IR'));
    players.set('ir2', mk('ir2', 'OUT'));
    entries.push({ playerId: 'ir1', onIr: true }, { playerId: 'ir2', onIr: true });
    expect(validateRoster(entries, players, DEFAULT_LEAGUE)).toEqual([]); // 22 + 2 OK

    // A 23rd non-IR player exceeds the roster even though IR has room semantics.
    players.set('x', mk('x'));
    expect(validateRoster([...entries, { playerId: 'x', onIr: false }], players, DEFAULT_LEAGUE)).toEqual([
      { kind: 'over-roster', count: 23, limit: 22 },
    ]);
    // A third IR player exceeds IR capacity.
    players.set('ir3', mk('ir3', 'IR'));
    expect(validateRoster([...entries, { playerId: 'ir3', onIr: true }], players, DEFAULT_LEAGUE)).toEqual([
      { kind: 'over-ir', count: 3, limit: 2 },
    ]);
    // Changing the config changes the limits.
    const smaller = { ...DEFAULT_LEAGUE, rosterSize: 20, irSlots: 1 };
    expect(validateRoster(entries, players, smaller).map((i) => i.kind)).toEqual(['over-roster', 'over-ir']);
  });

  it('IR is the user\'s selection: no injury status or mark is needed, only the IR slot limit applies', () => {
    const players = new Map([['h', mk('h')], ['k', mk('k')], ['m', mk('m')]]); // none injured in the data
    const entries = [{ playerId: 'h', onIr: true }, { playerId: 'k', onIr: true }];
    expect(validateRoster(entries, players, DEFAULT_LEAGUE)).toEqual([]);
    expect(validateRoster([...entries, { playerId: 'm', onIr: true }], players, DEFAULT_LEAGUE)).toEqual([{ kind: 'over-ir', count: 3, limit: 2 }]);
  });
});

describe('schedule + rankings', () => {
  it('counts each team game once per period and once in the total', () => {
    const s = sched([
      ['2027-02-22', 'AAA', 'BBB'],
      ['2027-03-07', 'AAA', 'CCC'],
      ['2027-03-08', 'BBB', 'CCC'],
      ['2027-03-09', 'AAA', 'BBB'],
    ]);
    const r = rankTeams(s, ['AAA', 'BBB', 'CCC'], [
      { start: '2027-02-22', end: '2027-03-07' },
      { start: '2027-03-08', end: '2027-03-21' },
    ]);
    const byTeam = Object.fromEntries(r.map((t) => [t.team, t]));
    expect(byTeam.AAA!.byPeriod).toEqual([2, 1]);
    expect(byTeam.AAA!.total).toBe(3);
    expect(byTeam.CCC!.byPeriod).toEqual([1, 1]);
  });

  it('does not double count overlapping custom periods in the total', () => {
    const s = sched([['2027-03-01', 'AAA', 'BBB']]);
    const r = rankTeams(s, ['AAA', 'BBB'], [
      { start: '2027-03-01', end: '2027-03-02' },
      { start: '2027-02-28', end: '2027-03-01' },
    ]);
    expect(r[0]!.byPeriod).toEqual([1, 1]);
    expect(r[0]!.total).toBe(1);
  });

  it('light nights are dates where at most half the teams play', () => {
    expect(isLightNight(8, 32)).toBe(true);
    expect(isLightNight(9, 32)).toBe(false);
    expect(isLightNight(0, 32)).toBe(false);
  });

  it('duplicate game records are ignored', () => {
    const s = sched([['2027-03-01', 'AAA', 'BBB']]);
    const dup = new (s.constructor as typeof import('./schedule.ts').ScheduleIndex)([...s.games, ...s.games]);
    expect(playerGames(dup, { team: 'AAA' }, '2027-03-01', '2027-03-01')).toHaveLength(1);
  });
});
