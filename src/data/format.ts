import type { Game, Player, Team } from '../domain/types.ts';

/** Bump when the on-disk shape changes incompatibly. */
export const DATA_VERSION = 1;

export interface ScheduleFile {
  version: number;
  /** NHL season id, e.g. "20262027". */
  season: string;
  fetchedAt: string;
  source: string;
  teams: Team[];
  /** Regular-season games only, each listed once, dated by the NHL's (Eastern) game date. */
  games: Game[];
}

export interface PlayersFile {
  version: number;
  season: string;
  fetchedAt: string;
  sources: {
    rosters: string;
    eligibility: { source: 'espn' | 'nhl'; detail: string };
  };
  players: (Player & {
    /** Not on an NHL active roster at the latest refresh (e.g. assigned to the minors). */
    inactive?: boolean;
  })[];
}

/** NHL skater position codes as reported by the stats API. */
export type SkaterPositionCode = 'C' | 'L' | 'R' | 'D';

/**
 * One skater's current-season regular-season totals (Player Evaluator V1).
 * Joined from the NHL Stats REST summary, realtime and faceoffwins reports.
 */
export interface SkaterStatLine {
  /** NHL player id; the same id as `Player.nhlId`. */
  nhlId: number;
  name: string;
  /** Every team this season, in the API's order (traded players have several). Not the current team. */
  teams: string[];
  position: SkaterPositionCode;
  /** Always at least 1: the API has no row for skaters who haven't played. */
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  plusMinus: number;
  penaltyMinutes: number;
  ppPoints: number;
  shPoints: number;
  shots: number;
  hits: number;
  blockedShots: number;
  faceoffWins: number;
  /** goals / shots as a 0–1 fraction; null with no shots. */
  shootingPct: number | null;
  /** 0–1 fraction; null with no faceoffs taken. */
  faceoffWinPct: number | null;
  /** Average time on ice per game, in seconds. */
  toiPerGame: number;
}

export interface SkaterStatsFile {
  version: number;
  season: string;
  /** NHL game type; always 2 (regular season). */
  gameType: 2;
  fetchedAt: string;
  source: string;
  skaters: SkaterStatLine[];
}
