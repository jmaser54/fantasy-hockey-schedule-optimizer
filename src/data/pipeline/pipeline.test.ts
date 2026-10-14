// Parser/reconciliation tests on tiny hand-written fixtures shaped like the
// NHL and ESPN responses. These verify logic, not real-world data.
import { describe, expect, it } from 'vitest';
import type { PlayersFile } from '../format.ts';
import { validatePlayers, validateSchedule } from '../validate.ts';
import { espnPositions, inferSlotMapping, parseEspnPlayers, type EspnPlayer } from './espn.ts';
import { mergeClubSchedules, parseClubSchedule, parseRoster, parseStandingsTeams } from './nhl.ts';
import { applyHistory, reconcilePlayers } from './reconcile.ts';
import type { NhlRosterPlayer } from './nhl.ts';

const game = (id: number, date: string, home: string, away: string, extra: Record<string, unknown> = {}) => ({
  id,
  season: 20262027,
  gameType: 2,
  gameDate: date,
  startTimeUTC: `${date}T23:00:00Z`,
  easternUTCOffset: '-05:00',
  gameScheduleState: 'OK',
  homeTeam: { id: 1, abbrev: home },
  awayTeam: { id: 2, abbrev: away },
  ...extra,
});

describe('NHL parsers', () => {
  it('parses standings into teams', () => {
    expect(parseStandingsTeams({ standings: [{ teamAbbrev: { default: 'TOR' }, teamName: { default: 'Toronto Maple Leafs' } }] })).toEqual([
      { id: 'TOR', name: 'Toronto Maple Leafs' },
    ]);
    expect(() => parseStandingsTeams({})).toThrow(/standings/);
  });

  it('keeps regular-season games and skips preseason/postponed ones', () => {
    const r = parseClubSchedule(
      {
        games: [
          game(1, '2026-09-20', 'TOR', 'MTL', { gameType: 1 }),
          game(2, '2026-10-01', 'TOR', 'MTL'),
          game(3, '2026-10-03', 'BOS', 'TOR', { gameScheduleState: 'PPD' }),
          game(4, '2026-10-05', 'BOS', 'TOR', { gameDate: undefined, startTimeUTC: '2026-10-06T02:30:00Z', easternUTCOffset: '-04:00' }),
        ],
      },
      '20262027',
    );
    expect(r.games).toEqual([
      { id: '2', date: '2026-10-01', home: 'TOR', away: 'MTL' },
      { id: '4', date: '2026-10-05', home: 'BOS', away: 'TOR' }, // derived from UTC + Eastern offset
    ]);
    expect(r.skipped).toEqual([{ id: '3', reason: 'schedule state PPD' }]);
  });

  it('rejects unexpected shapes', () => {
    expect(() => parseClubSchedule({ gameWeek: [] }, '20262027')).toThrow(/games/);
    expect(() => parseClubSchedule({ games: [game(1, 'soon', 'A', 'B')] }, '20262027')).toThrow(/date/);
    expect(() => parseRoster({ forwards: [] }, 'TOR')).toThrow(/defensemen/);
  });

  it('merges team schedules, deduplicating and cross-checking', () => {
    const a = { id: '9', date: '2027-03-01', home: 'TOR', away: 'MTL' };
    const ok = mergeClubSchedules(new Map([['TOR', [a]], ['MTL', [a]]]));
    expect(ok.games).toEqual([a]);
    expect(ok.errors).toEqual([]);
    const conflict = mergeClubSchedules(new Map([['TOR', [a]], ['MTL', [{ ...a, date: '2027-03-02' }]]]));
    expect(conflict.errors[0]).toMatch(/differs/);
    const missing = mergeClubSchedules(new Map([['TOR', [a]], ['MTL', []]]));
    expect(missing.errors[0]).toMatch(/missing from MTL/);
  });

  it('parses rosters', () => {
    const body = {
      forwards: [{ id: 8478483, firstName: { default: 'Mitch' }, lastName: { default: 'Marner' }, positionCode: 'R' }],
      defensemen: [],
      goalies: [{ id: 1, firstName: { default: 'A' }, lastName: { default: 'B' }, positionCode: 'G' }],
    };
    expect(parseRoster(body, 'TOR')).toEqual([
      { nhlId: 8478483, name: 'Mitch Marner', team: 'TOR', positionCode: 'R' },
      { nhlId: 1, name: 'A B', team: 'TOR', positionCode: 'G' },
    ]);
  });
});

describe('dataset validation', () => {
  const teams = [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }];
  it('flags duplicate games, double-booked teams and wrong game counts', () => {
    const base = { version: 1, season: 's', fetchedAt: '', source: '', teams };
    expect(validateSchedule({ ...base, games: [{ id: '1', date: '2027-03-01', home: 'A', away: 'B' }] }).errors).toEqual([]);
    const dup = validateSchedule({
      ...base,
      games: [
        { id: '1', date: '2027-03-01', home: 'A', away: 'B' },
        { id: '1', date: '2027-03-01', home: 'A', away: 'B' },
      ],
    });
    expect(dup.errors.some((e) => e.includes('Duplicate game'))).toBe(true);
    const twice = validateSchedule({
      ...base,
      games: [
        { id: '1', date: '2027-03-01', home: 'A', away: 'B' },
        { id: '2', date: '2027-03-01', home: 'C', away: 'A' },
      ],
    });
    expect(twice.errors).toContain('A has two games on 2027-03-01.');
    expect(validateSchedule({ ...base, games: [] }, { expectedGamesPerTeam: 84 }).errors).toContain('A has 0 games; expected 84.');
    expect(validateSchedule({ ...base, version: 99, games: [] }).errors[0]).toMatch(/version/);
  });

  it('flags players on unknown teams and duplicate ids', () => {
    const r = validatePlayers(
      {
        version: 1,
        players: [
          { id: 'x', name: 'X', team: 'A', positions: ['C'], nhlId: 1 },
          { id: 'y', name: 'Y', team: 'Z', positions: ['C'], nhlId: 1 },
        ],
      },
      new Set(['A']),
    );
    expect(r.errors).toEqual(['NHL id 1 appears twice.', 'Y is on unknown team Z.']);
  });
});

/** Synthetic league: 6 teams × (2C, 2LW, 2RW, 3D, 2G) = enough votes to infer mappings. */
function synthetic() {
  const nhl: NhlRosterPlayer[] = [];
  const espn: EspnPlayer[] = [];
  // ESPN-like ids (arbitrary here): default positions 1..5; slots C=0, LW=1, RW=2, F=3, D=4, G=5, UTIL=6, BE=7, IR=8.
  const def = { C: 1, L: 2, R: 3, D: 4, G: 5 } as const;
  const slotsFor = { C: [0, 3, 6, 7, 8], L: [1, 3, 6, 7, 8], R: [2, 3, 6, 7, 8], D: [4, 6, 7, 8], G: [5, 7, 8] } as const;
  const teams = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'];
  let id = 100;
  teams.forEach((team, ti) => {
    for (const [code, n] of [['C', 2], ['L', 2], ['R', 2], ['D', 3], ['G', 2]] as const) {
      for (let i = 0; i < n; i++) {
        id++;
        const name = `${code}${i} Player${team}`;
        nhl.push({ nhlId: id, name, team, positionCode: code });
        espn.push({ espnId: id + 5000, name, proTeamId: ti + 1, defaultPositionId: def[code], eligibleSlots: [...slotsFor[code]] });
      }
    }
  });
  return { nhl, espn };
}

describe('ESPN reconciliation', () => {
  it('infers slot ids and team ids from matched players', () => {
    const { nhl, espn } = synthetic();
    // Make one center also LW-eligible (a dual-position player).
    espn[0]!.eligibleSlots.push(1);
    const res = reconcilePlayers({ nhl, espn, today: '2027-03-01' });
    expect(res.eligibility.source).toBe('espn');
    const dual = res.players.find((p) => p.nhlId === nhl[0]!.nhlId)!;
    expect(dual.positions).toEqual(['C', 'LW']);
    expect(dual.espnId).toBe(espn[0]!.espnId);
    expect(res.players.every((p) => p.eligibilitySource === 'espn')).toBe(true);
  });

  it('falls back to NHL positions when ESPN ids cannot be inferred cleanly', () => {
    const { nhl, espn } = synthetic();
    for (const e of espn) e.eligibleSlots = [7]; // no position-specific slots at all
    const res = reconcilePlayers({ nhl, espn, today: '2027-03-01' });
    expect(res.eligibility.source).toBe('nhl');
    expect(res.warnings[0]).toMatch(/ESPN eligibility not used/);
    expect(res.players.find((p) => p.nhlId === nhl[0]!.nhlId)!.positions).toEqual(['C']);
  });

  it('never merges two same-name players without a team to separate them', () => {
    const { nhl, espn } = synthetic();
    // Two NHL players named "Elias Pettersson" on different teams; ESPN knows both.
    nhl.push({ nhlId: 1, name: 'Elias Pettersson', team: 'AAA', positionCode: 'C' });
    nhl.push({ nhlId: 2, name: 'Elias Pettersson', team: 'BBB', positionCode: 'D' });
    espn.push({ espnId: 11, name: 'Elias Pettersson', proTeamId: 1, defaultPositionId: 1, eligibleSlots: [0, 3, 6, 7, 8] });
    espn.push({ espnId: 12, name: 'Elias Pettersson', proTeamId: 2, defaultPositionId: 4, eligibleSlots: [4, 6, 7, 8] });
    const res = reconcilePlayers({ nhl, espn, today: '2027-03-01' });
    const ep = res.players.filter((p) => p.name === 'Elias Pettersson');
    expect(ep.map((p) => [p.nhlId, p.espnId, p.positions])).toEqual([
      [1, 11, ['C']],
      [2, 12, ['D']],
    ]);
  });

  it('parses the ESPN player shape and ignores ACTIVE status', () => {
    const parsed = parseEspnPlayers([{ id: 1, fullName: 'A', proTeamId: 3, defaultPositionId: 1, eligibleSlots: [0], injuryStatus: 'ACTIVE' }]);
    expect(parsed[0]!.injuryStatus).toBeUndefined();
    expect(() => parseEspnPlayers({ players: [] })).toThrow();
    const inf = inferSlotMapping(synthetic().espn.map((e) => ({ espn: e, nhlPosition: (['C', 'LW', 'RW', 'D', 'G'] as const)[e.defaultPositionId - 1]! })));
    expect(espnPositions({ espnId: 1, name: '', proTeamId: 1, defaultPositionId: 1, eligibleSlots: [0, 2, 6] }, inf.slotPosition)).toEqual(['C', 'RW']);
  });
});

describe('team history across refreshes', () => {
  const prevFile = (team: string, stints?: PlayersFile['players'][number]['stints']): PlayersFile => ({
    version: 1,
    season: '20262027',
    fetchedAt: '',
    sources: { rosters: '', eligibility: { source: 'nhl', detail: '' } },
    players: [{ id: 'nhl-7', name: 'Traded Guy', team, positions: ['C'], eligibilitySource: 'nhl', nhlId: 7, stints }],
  });

  it('records a trade as consecutive, non-overlapping stints', () => {
    const now: PlayersFile['players'] = [{ id: 'nhl-7', name: 'Traded Guy', team: 'BBB', positions: ['C'], eligibilitySource: 'nhl', nhlId: 7 }];
    applyHistory(now, prevFile('AAA'), '2027-03-05', []);
    expect(now[0]!.stints).toEqual([
      { team: 'AAA', to: '2027-03-04' },
      { team: 'BBB', from: '2027-03-05' },
    ]);
    // A later refresh with no change carries the history forward unchanged.
    const later: PlayersFile['players'] = [{ ...now[0]!, stints: undefined }];
    applyHistory(later, { ...prevFile('BBB'), players: [now[0]!] }, '2027-03-10', []);
    expect(later[0]!.stints).toEqual(now[0]!.stints);
  });

  it('keeps players who left every roster, flagged inactive', () => {
    const now: PlayersFile['players'] = [];
    applyHistory(now, prevFile('AAA'), '2027-03-05', []);
    expect(now).toHaveLength(1);
    expect(now[0]!.inactive).toBe(true);
  });
});
