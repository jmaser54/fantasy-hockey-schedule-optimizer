/**
 * Core domain types. Dates are always ISO calendar-date strings (YYYY-MM-DD)
 * in the NHL's schedule date convention (US Eastern game date). No Date
 * objects cross module boundaries, which keeps period boundaries exact.
 */

export type ISODate = string;

/** Fantasy positions a player can be eligible for. */
export const POSITIONS = ['C', 'LW', 'RW', 'D', 'G'] as const;
export type Position = (typeof POSITIONS)[number];

export const POSITION_LABELS: Record<Position, string> = {
  C: 'Center',
  LW: 'Left wing',
  RW: 'Right wing',
  D: 'Defense',
  G: 'Goalie',
};

/** NHL team abbreviation, e.g. "TOR". */
export type TeamId = string;

export interface Team {
  id: TeamId;
  name: string;
}

export interface Game {
  id: string;
  date: ISODate;
  home: TeamId;
  away: TeamId;
}

/** A period of time a player belongs to a given NHL team (inclusive bounds). */
export interface TeamStint {
  team: TeamId;
  /** First date (inclusive) of the stint; undefined = since forever. */
  from?: ISODate;
  /** Last date (inclusive) of the stint; undefined = open-ended. */
  to?: ISODate;
}

export interface Player {
  id: string;
  name: string;
  /** Current team (the stint covering the latest snapshot). */
  team: TeamId;
  /** Team history; when absent the player belongs to `team` for all dates. */
  stints?: TeamStint[];
  /** Fantasy-eligible positions. */
  positions: Position[];
  /** Where the eligibility came from. */
  eligibilitySource: 'espn' | 'nhl' | 'user';
  /** Injury flag from the data source, if any (e.g. "IR", "OUT"). */
  injuryStatus?: string;
  nhlId?: number;
  espnId?: number;
}

export interface LineupSlot {
  id: string;
  label: string;
  count: number;
  accepts: Position[];
}

export type IrEligibility = 'any' | 'injured';

export interface LeagueConfig {
  /** Total roster capacity, excluding IR. */
  rosterSize: number;
  /** IR slots, in addition to rosterSize. */
  irSlots: number;
  irEligibility: IrEligibility;
  /** Active daily lineup slots. Everyone else non-IR is on the bench. */
  slots: LineupSlot[];
}

export interface Period {
  id: string;
  name: string;
  start: ISODate;
  end: ISODate;
}

export interface RosterEntry {
  playerId: string;
  /** Stored on IR (counts against irSlots, never in the active lineup). */
  onIr: boolean;
  /** User-specified eligibility override; replaces the data-source positions. */
  positionsOverride?: Position[];
  /** User says this player is injured (for IR eligibility). */
  markedInjured?: boolean;
  /** Gets lineup spots first when players compete for them (stored only when true). */
  preferred?: boolean;
}
