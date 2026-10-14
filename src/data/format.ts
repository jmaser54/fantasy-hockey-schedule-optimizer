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
