/**
 * NHL Stats REST API (api.nhle.com/stats/rest) skater reports for Player
 * Evaluator. Behaviour verified on 2026-11-20 (docs/PROJECT_SOURCE_OF_TRUTH.md
 * §I): pages hold at most 100 rows whatever `limit` says, pagination is only
 * stable when sorted on the unique playerId, rows carry no gameTypeId (so the
 * query must always filter it), and the three reports cover the same players.
 * Like nhl.ts, every field we rely on is checked and anything unexpected throws.
 */
import type { SkaterPositionCode, SkaterStatLine } from '../format.ts';

export const STATS_BASE = 'https://api.nhle.com/stats/rest/en';
export const STATS_GAME_TYPE = 2;
export const STATS_PAGE_SIZE = 100;
export const STATS_REPORTS = ['summary', 'realtime', 'faceoffwins'] as const;
export type StatsReport = (typeof STATS_REPORTS)[number];
/** Generous ceiling (100 pages = 10,000 skaters) so a misbehaving API can't loop forever. */
const MAX_PAGES = 100;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const POSITION_CODES: readonly SkaterPositionCode[] = ['C', 'L', 'R', 'D'];

export function statsPageUrl(report: StatsReport, season: string, start: number): string {
  const p = new URLSearchParams({
    isAggregate: 'false',
    isGame: 'false',
    start: String(start),
    limit: String(STATS_PAGE_SIZE),
    sort: JSON.stringify([{ property: 'playerId', direction: 'ASC' }]),
    cayenneExp: `gameTypeId=${STATS_GAME_TYPE} and seasonId<=${season} and seasonId>=${season}`,
  });
  return `${STATS_BASE}/skater/${report}?${p}`;
}

/** One page → its rows and the API's reported total. */
export function parseStatsPage(body: unknown, report: StatsReport): { rows: Json[]; total: number } {
  if (!isObj(body) || !Array.isArray(body.data) || !Number.isInteger(body.total)) {
    throw new Error(`Stats API: ${report} response has no "data" array or integer "total"`);
  }
  const rows = body.data.map((r, i) => {
    if (!isObj(r)) throw new Error(`Stats API: ${report} row ${i} is not an object`);
    return r;
  });
  return { rows, total: body.total as number };
}

/**
 * Fetch every page of a report. Throws unless exactly `total` distinct players
 * came back and the total didn't change mid-fetch.
 */
export async function fetchStatsReport(
  getJson: (url: string) => Promise<unknown>,
  report: StatsReport,
  season: string,
): Promise<{ rows: Json[]; firstPage: unknown }> {
  const rows: Json[] = [];
  let total: number | undefined;
  let firstPage: unknown;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await getJson(statsPageUrl(report, season, page * STATS_PAGE_SIZE));
    if (page === 0) firstPage = body;
    const parsed = parseStatsPage(body, report);
    if (total === undefined) total = parsed.total;
    else if (parsed.total !== total) throw new Error(`Stats API: ${report} total changed during the fetch (${total} → ${parsed.total})`);
    rows.push(...parsed.rows);
    if (parsed.rows.length < STATS_PAGE_SIZE || rows.length >= total) break;
  }
  if (rows.length !== total) throw new Error(`Stats API: ${report} returned ${rows.length} rows; expected ${String(total)}`);
  const ids = new Set(rows.map((r) => r.playerId));
  if (ids.size !== rows.length) throw new Error(`Stats API: ${report} returned ${rows.length - ids.size} duplicate players`);
  return { rows, firstPage };
}

function int(row: Json, key: string, report: StatsReport): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`Stats API: ${report} player ${String(row.playerId)} has no integer "${key}"`);
  return v;
}
function num(row: Json, key: string, report: StatsReport): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Stats API: ${report} player ${String(row.playerId)} has no number "${key}"`);
  return v;
}
function numOrNull(row: Json, key: string, report: StatsReport): number | null {
  if (row[key] === null) return null;
  return num(row, key, report);
}
function str(row: Json, key: string, report: StatsReport): string {
  const v = row[key];
  if (typeof v !== 'string' || !v) throw new Error(`Stats API: ${report} player ${String(row.playerId)} has no "${key}"`);
  return v;
}

/**
 * Join the three reports on playerId into V1 stat lines (sorted by nhlId).
 * Throws if the reports cover different players, disagree on games played,
 * or any row is for another season.
 */
export function joinSkaterStats(reports: Record<StatsReport, readonly Json[]>, season: string): SkaterStatLine[] {
  const byId = (report: StatsReport) => {
    const m = new Map<number, Json>();
    for (const r of reports[report]) {
      const id = int(r, 'playerId', report);
      if (m.has(id)) throw new Error(`Stats API: ${report} lists player ${id} twice`);
      if (String(r.seasonId) !== season) throw new Error(`Stats API: ${report} player ${id} is for season ${String(r.seasonId)}`);
      m.set(id, r);
    }
    return m;
  };
  const summary = byId('summary');
  const realtime = byId('realtime');
  const faceoffs = byId('faceoffwins');
  for (const [name, m] of [['realtime', realtime], ['faceoffwins', faceoffs]] as const) {
    const missing = [...summary.keys()].filter((id) => !m.has(id));
    const extra = [...m.keys()].filter((id) => !summary.has(id));
    if (missing.length || extra.length) {
      throw new Error(`Stats API: summary and ${name} cover different players (missing ${missing.slice(0, 5).join(',') || 'none'}; extra ${extra.slice(0, 5).join(',') || 'none'})`);
    }
  }
  const lines: SkaterStatLine[] = [];
  for (const [id, s] of summary) {
    const rt = realtime.get(id)!;
    const fo = faceoffs.get(id)!;
    const gamesPlayed = int(s, 'gamesPlayed', 'summary');
    if (int(rt, 'gamesPlayed', 'realtime') !== gamesPlayed || int(fo, 'gamesPlayed', 'faceoffwins') !== gamesPlayed) {
      throw new Error(`Stats API: reports disagree on games played for player ${id}`);
    }
    const position = str(s, 'positionCode', 'summary') as SkaterPositionCode;
    if (!POSITION_CODES.includes(position)) throw new Error(`Stats API: player ${id} has unexpected position ${position}`);
    lines.push({
      nhlId: id,
      name: str(s, 'skaterFullName', 'summary'),
      teams: str(s, 'teamAbbrevs', 'summary').split(',').map((t) => t.trim()),
      position,
      gamesPlayed,
      goals: int(s, 'goals', 'summary'),
      assists: int(s, 'assists', 'summary'),
      points: int(s, 'points', 'summary'),
      plusMinus: int(s, 'plusMinus', 'summary'),
      penaltyMinutes: int(s, 'penaltyMinutes', 'summary'),
      ppPoints: int(s, 'ppPoints', 'summary'),
      shPoints: int(s, 'shPoints', 'summary'),
      shots: int(s, 'shots', 'summary'),
      hits: int(rt, 'hits', 'realtime'),
      blockedShots: int(rt, 'blockedShots', 'realtime'),
      faceoffWins: int(fo, 'totalFaceoffWins', 'faceoffwins'),
      shootingPct: numOrNull(s, 'shootingPct', 'summary'),
      faceoffWinPct: numOrNull(s, 'faceoffWinPct', 'summary'),
      toiPerGame: num(s, 'timeOnIcePerGame', 'summary'),
    });
  }
  return lines.sort((a, b) => a.nhlId - b.nhlId);
}
