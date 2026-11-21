// Player Evaluator stats pipeline tests on small fixtures shaped like the NHL
// Stats REST responses verified on 2026-11-20. They test logic, not live data.
import { describe, expect, it } from 'vitest';
import type { SkaterStatsFile } from '../format.ts';
import { validateSkaterStats } from '../validate.ts';
import { fetchStatsReport, joinSkaterStats, parseStatsPage, STATS_PAGE_SIZE, statsPageUrl } from './stats.ts';

const SEASON = '20262027';

const summaryRow = (playerId: number, extra: Record<string, unknown> = {}) => ({
  playerId,
  skaterFullName: `Player ${playerId}`,
  lastName: `P${playerId}`,
  positionCode: 'C',
  teamAbbrevs: 'TOR',
  seasonId: 20262027,
  gamesPlayed: 10,
  goals: 4,
  assists: 6,
  points: 10,
  plusMinus: -2,
  penaltyMinutes: 8,
  ppPoints: 3,
  shPoints: 1,
  shots: 20,
  shootingPct: 0.2,
  faceoffWinPct: 0.55,
  timeOnIcePerGame: 1012.4,
  ...extra,
});
const realtimeRow = (playerId: number, extra: Record<string, unknown> = {}) => ({ playerId, seasonId: 20262027, gamesPlayed: 10, hits: 15, blockedShots: 7, ...extra });
const faceoffRow = (playerId: number, extra: Record<string, unknown> = {}) => ({ playerId, seasonId: 20262027, gamesPlayed: 10, totalFaceoffWins: 55, totalFaceoffLosses: 45, totalFaceoffs: 100, ...extra });

const reports = (ids: number[]) => ({
  summary: ids.map((id) => summaryRow(id)),
  realtime: ids.map((id) => realtimeRow(id)),
  faceoffwins: ids.map((id) => faceoffRow(id)),
});

const statsFile = (skaters: SkaterStatsFile['skaters']): SkaterStatsFile => ({
  version: 1,
  season: SEASON,
  gameType: 2,
  fetchedAt: '2026-11-20T10:17:00.000Z',
  source: 'test',
  skaters,
});

describe('stats API requests and pages', () => {
  it('always filters regular season and the season, sorts on playerId and pages by 100', () => {
    const u = new URL(statsPageUrl('realtime', SEASON, 200));
    expect(u.pathname).toBe('/stats/rest/en/skater/realtime');
    expect(u.searchParams.get('cayenneExp')).toBe('gameTypeId=2 and seasonId<=20262027 and seasonId>=20262027');
    expect(u.searchParams.get('sort')).toBe('[{"property":"playerId","direction":"ASC"}]');
    expect(u.searchParams.get('start')).toBe('200');
    expect(u.searchParams.get('limit')).toBe('100');
    expect(u.searchParams.get('isAggregate')).toBe('false');
  });

  it('rejects malformed pages', () => {
    expect(parseStatsPage({ data: [summaryRow(1)], total: 1 }, 'summary').total).toBe(1);
    expect(() => parseStatsPage({ data: [] }, 'summary')).toThrow(/total/);
    expect(() => parseStatsPage({ total: 3 }, 'summary')).toThrow(/data/);
    expect(() => parseStatsPage({ data: [null], total: 1 }, 'summary')).toThrow(/row 0/);
  });
});

describe('fetchStatsReport pagination', () => {
  const pagedApi = (all: Record<string, unknown>[], opts: { total?: (page: number) => number } = {}) => {
    const urls: string[] = [];
    const getJson = async (url: string) => {
      urls.push(url);
      const start = Number(new URL(url).searchParams.get('start'));
      const page = start / STATS_PAGE_SIZE;
      return { data: all.slice(start, start + STATS_PAGE_SIZE), total: opts.total?.(page) ?? all.length };
    };
    return { urls, getJson };
  };

  it('walks every page until the total is reached', async () => {
    const all = Array.from({ length: 250 }, (_, i) => summaryRow(8470000 + i));
    const api = pagedApi(all);
    const { rows, firstPage } = await fetchStatsReport(api.getJson, 'summary', SEASON);
    expect(rows).toHaveLength(250);
    expect(api.urls.map((u) => new URL(u).searchParams.get('start'))).toEqual(['0', '100', '200']);
    expect((firstPage as { data: unknown[] }).data).toHaveLength(100);
  });

  it('stops after an exactly full last page', async () => {
    const api = pagedApi(Array.from({ length: 200 }, (_, i) => summaryRow(i + 1)));
    expect((await fetchStatsReport(api.getJson, 'summary', SEASON)).rows).toHaveLength(200);
    expect(api.urls).toHaveLength(2);
  });

  it('throws when fewer rows arrive than the total (e.g. a capped page)', async () => {
    const api = pagedApi(Array.from({ length: 150 }, (_, i) => summaryRow(i + 1)), { total: () => 782 });
    await expect(fetchStatsReport(api.getJson, 'summary', SEASON)).rejects.toThrow(/150 rows; expected 782/);
  });

  it('throws when the total changes mid-fetch', async () => {
    const api = pagedApi(Array.from({ length: 150 }, (_, i) => summaryRow(i + 1)), { total: (p) => (p === 0 ? 150 : 151) });
    await expect(fetchStatsReport(api.getJson, 'summary', SEASON)).rejects.toThrow(/total changed/);
  });

  it('throws on duplicate players across pages (unstable pagination)', async () => {
    const all = Array.from({ length: 150 }, (_, i) => summaryRow(i < 100 ? i + 1 : i - 50));
    await expect(fetchStatsReport(pagedApi(all).getJson, 'summary', SEASON)).rejects.toThrow(/duplicate/);
  });

  it('propagates fetch failures', async () => {
    await expect(fetchStatsReport(async () => Promise.reject(new Error('HTTP 500')), 'summary', SEASON)).rejects.toThrow(/HTTP 500/);
  });
});

describe('joinSkaterStats', () => {
  it('joins the three reports on playerId into V1 stat lines', () => {
    const r = reports([8478402, 8470613]);
    r.summary[1] = summaryRow(8470613, { teamAbbrevs: 'PIT,EDM', positionCode: 'D', shots: 0, goals: 0, assists: 10, shootingPct: null, faceoffWinPct: null });
    r.faceoffwins[1] = faceoffRow(8470613, { totalFaceoffWins: 0, totalFaceoffLosses: 0, totalFaceoffs: 0 });
    const lines = joinSkaterStats(r, SEASON);
    expect(lines.map((l) => l.nhlId)).toEqual([8470613, 8478402]);
    expect(lines[1]).toEqual({
      nhlId: 8478402,
      name: 'Player 8478402',
      teams: ['TOR'],
      position: 'C',
      gamesPlayed: 10,
      goals: 4,
      assists: 6,
      points: 10,
      plusMinus: -2,
      penaltyMinutes: 8,
      ppPoints: 3,
      shPoints: 1,
      shots: 20,
      hits: 15,
      blockedShots: 7,
      faceoffWins: 55,
      shootingPct: 0.2,
      faceoffWinPct: 0.55,
      toiPerGame: 1012.4,
    });
    expect(lines[0]).toMatchObject({ teams: ['PIT', 'EDM'], position: 'D', shootingPct: null, faceoffWinPct: null, faceoffWins: 0 });
  });

  it('rejects reports that cover different players', () => {
    const r = reports([1, 2]);
    r.realtime = [realtimeRow(1)];
    expect(() => joinSkaterStats(r, SEASON)).toThrow(/summary and realtime cover different players/);
    const r2 = reports([1]);
    r2.faceoffwins.push(faceoffRow(3));
    expect(() => joinSkaterStats(r2, SEASON)).toThrow(/faceoffwins cover different players.*extra 3/);
  });

  it('rejects other seasons, games-played disagreements, goalies and missing fields', () => {
    const wrongSeason = reports([1]);
    wrongSeason.realtime[0] = realtimeRow(1, { seasonId: 20252026 });
    expect(() => joinSkaterStats(wrongSeason, SEASON)).toThrow(/season 20252026/);
    const gp = reports([1]);
    gp.faceoffwins[0] = faceoffRow(1, { gamesPlayed: 9 });
    expect(() => joinSkaterStats(gp, SEASON)).toThrow(/games played/);
    const goalie = reports([1]);
    goalie.summary[0] = summaryRow(1, { positionCode: 'G' });
    expect(() => joinSkaterStats(goalie, SEASON)).toThrow(/position G/);
    const missing = reports([1]);
    missing.realtime[0] = realtimeRow(1, { hits: null });
    expect(() => joinSkaterStats(missing, SEASON)).toThrow(/integer "hits"/);
    const dup = reports([1]);
    dup.summary.push(summaryRow(1));
    expect(() => joinSkaterStats(dup, SEASON)).toThrow(/twice/);
  });
});

describe('validateSkaterStats', () => {
  const good = () => statsFile(joinSkaterStats(reports([1, 2, 3]), SEASON));
  const teams = new Set(['TOR', 'EDM']);

  it('accepts a consistent snapshot', () => {
    expect(validateSkaterStats(good(), { season: SEASON, teamIds: teams })).toEqual({ errors: [], warnings: [] });
  });

  it('rejects wrong season, game type, version and missing fetchedAt', () => {
    expect(validateSkaterStats({ ...good(), season: '20252026' }, { season: SEASON }).errors.join()).toMatch(/expected 20262027/);
    expect(validateSkaterStats({ ...good(), gameType: 3 }).errors.join()).toMatch(/game type 3/);
    expect(validateSkaterStats({ ...good(), version: 2 }).errors.join()).toMatch(/version 2/);
    expect(validateSkaterStats({ ...good(), fetchedAt: 'never' }).errors.join()).toMatch(/fetchedAt/);
    expect(validateSkaterStats({ ...good(), skaters: [] }).errors.join()).toMatch(/no skaters/);
    expect(validateSkaterStats(null).errors).toEqual(['Skater stats file is not an object.']);
  });

  it('rejects duplicates, unknown teams, bad numbers and broken identities', () => {
    const f = good();
    const s = f.skaters;
    s[1] = { ...s[0]! };
    expect(validateSkaterStats(f).errors.join()).toMatch(/appears twice/);
    const check = (patch: Partial<SkaterStatsFile['skaters'][number]>, re: RegExp) => {
      const g = good();
      g.skaters[0] = { ...g.skaters[0]!, ...patch };
      expect(validateSkaterStats(g, { teamIds: teams }).errors.join()).toMatch(re);
    };
    check({ teams: ['XXX'] }, /unknown team XXX/);
    check({ hits: -1 }, /invalid hits/);
    check({ goals: 1.5 }, /invalid goals/);
    check({ gamesPlayed: 0 }, /0 games played/);
    check({ points: 11 }, /goals \+ assists/);
    check({ ppPoints: 9, shPoints: 2 }, /PP \+ SH/);
    check({ shootingPct: 0.5 }, /shooting percentage/);
    check({ shots: 0 }, /shooting percentage/);
    check({ faceoffWinPct: 1.2 }, /faceoff percentage/);
    check({ faceoffWinPct: null }, /faceoff wins but no faceoff percentage/);
    check({ toiPerGame: 0 }, /time on ice/);
    check({ position: 'G' as never }, /unknown position G/);
  });

  it('allows null percentages with no shots or faceoffs', () => {
    const g = good();
    g.skaters[0] = { ...g.skaters[0]!, goals: 0, assists: 10, shots: 0, shootingPct: null, faceoffWins: 0, faceoffWinPct: null };
    expect(validateSkaterStats(g).errors).toEqual([]);
  });

  it('compares the player count with the previous same-season snapshot', () => {
    const prev = statsFile(joinSkaterStats(reports(Array.from({ length: 20 }, (_, i) => i + 1)), SEASON));
    const fewer = (n: number) => statsFile(prev.skaters.slice(0, n));
    expect(validateSkaterStats(fewer(17), { previous: prev }).errors.join()).toMatch(/previous snapshot had 20/);
    expect(validateSkaterStats(fewer(19), { previous: prev })).toEqual({ errors: [], warnings: ['1 fewer skaters than the previous snapshot.'] });
    expect(validateSkaterStats(fewer(5), { previous: { ...prev, season: '20252026' } }).errors).toEqual([]);
  });
});
