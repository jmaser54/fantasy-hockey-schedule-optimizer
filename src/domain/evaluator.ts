/**
 * Player Evaluator calculations (docs/PLAYER_EVALUATOR_SPEC.md §3). Pure and
 * UI-independent: callers pass the saved roster, a player resolver and the
 * skater-stats snapshot; nothing here reads or writes app state.
 *
 * Normalization: adjusted = actual / actualGP * benchmarkGP, for counting
 * stats only. Rate/context stats are shown unchanged. Values are never
 * rounded here. Players are matched to stats by NHL id only, never by name.
 */
import type { SkaterPositionCode, SkaterStatLine } from '../data/format.ts';
import { effectivePositions } from './roster.ts';
import type { Player, RosterEntry } from './types.ts';

// ---------------------------------------------------------------------------
// Statistic definitions (Confirmed V1 list, 2026-11-20)

export const SCALED_STATS = ['goals', 'assists', 'points', 'ppPoints', 'shPoints', 'shots', 'penaltyMinutes', 'hits', 'blockedShots', 'faceoffWins'] as const;
export const UNCHANGED_STATS = ['gamesPlayed', 'plusMinus', 'shootingPct', 'faceoffWinPct', 'toiPerGame'] as const;
export type ScaledStatKey = (typeof SCALED_STATS)[number];
export type UnchangedStatKey = (typeof UNCHANGED_STATS)[number];
export type StatKey = ScaledStatKey | UnchangedStatKey;

export interface StatDefinition {
  key: StatKey;
  label: string;
  /** Scaled by benchmark GP, or shown as reported. */
  treatment: 'scaled' | 'unchanged';
  /** Display unit hint; formatting itself belongs to the UI. */
  unit: 'count' | 'fraction' | 'seconds';
  /** Can be null in the data (no shots / no faceoffs). */
  nullable: boolean;
}

/** Every V1 statistic and its documented treatment (spec §3.4). */
export const STAT_DEFINITIONS: readonly StatDefinition[] = [
  { key: 'gamesPlayed', label: 'Games played', treatment: 'unchanged', unit: 'count', nullable: false },
  { key: 'goals', label: 'Goals', treatment: 'scaled', unit: 'count', nullable: false },
  { key: 'assists', label: 'Assists', treatment: 'scaled', unit: 'count', nullable: false },
  { key: 'points', label: 'Points', treatment: 'scaled', unit: 'count', nullable: false },
  { key: 'plusMinus', label: 'Plus/minus', treatment: 'unchanged', unit: 'count', nullable: false },
  { key: 'penaltyMinutes', label: 'Penalty minutes', treatment: 'scaled', unit: 'count', nullable: false },
  { key: 'ppPoints', label: 'Power-play points', treatment: 'scaled', unit: 'count', nullable: false },
  { key: 'shPoints', label: 'Short-handed points', treatment: 'scaled', unit: 'count', nullable: false },
  { key: 'shots', label: 'Shots on goal', treatment: 'scaled', unit: 'count', nullable: false },
  { key: 'shootingPct', label: 'Shooting percentage', treatment: 'unchanged', unit: 'fraction', nullable: true },
  { key: 'hits', label: 'Hits', treatment: 'scaled', unit: 'count', nullable: false },
  { key: 'blockedShots', label: 'Blocked shots', treatment: 'scaled', unit: 'count', nullable: false },
  { key: 'faceoffWins', label: 'Faceoff wins', treatment: 'scaled', unit: 'count', nullable: false },
  { key: 'faceoffWinPct', label: 'Faceoff percentage', treatment: 'unchanged', unit: 'fraction', nullable: true },
  { key: 'toiPerGame', label: 'Time on ice per game', treatment: 'unchanged', unit: 'seconds', nullable: false },
];

const SCALED = new Set<StatKey>(SCALED_STATS);
export const isScaledStat = (key: StatKey): key is ScaledStatKey => SCALED.has(key);

/**
 * actual / gamesPlayed * benchmarkGp, unrounded. Null (never a guess) when
 * games played or the benchmark is missing, zero or not a positive number.
 */
export function adjustedValue(actual: number, gamesPlayed: number | undefined, benchmarkGp: number | undefined): number | null {
  if (!gamesPlayed || !(gamesPlayed > 0) || !benchmarkGp || !(benchmarkGp > 0) || !Number.isFinite(actual)) return null;
  return (actual / gamesPlayed) * benchmarkGp;
}

export type StatsIndex = ReadonlyMap<number, SkaterStatLine>;
export const buildStatsIndex = (skaters: readonly SkaterStatLine[]): StatsIndex => new Map(skaters.map((s) => [s.nhlId, s]));

// ---------------------------------------------------------------------------
// Subjects: the players being evaluated (roster skaters and comparison players)

/**
 * - `ok`: matched by NHL id to a stats line (always ≥ 1 GP).
 * - `no-games`: has an NHL id but no stats line, i.e. no regular-season game
 *   recorded in the snapshot. Adjusted values are unavailable (no division by 0).
 * - `unmatched`: no NHL id (ESPN-only directory entry or custom player), so
 *   it can't be matched to NHL stats. Never matched by name.
 * - `unknown-player`: the saved roster id no longer resolves to any player.
 */
export type SubjectStatus = 'ok' | 'no-games' | 'unmatched' | 'unknown-player';

export interface Subject {
  source: 'roster' | 'comparison';
  /** Roster player id (roster subjects only). */
  playerId?: string;
  nhlId?: number;
  name: string;
  status: SubjectStatus;
  stats?: SkaterStatLine;
  /** Roster subjects: stored on IR (still a rostered skater). */
  onIr?: boolean;
}

export interface ExcludedGoalie {
  playerId: string;
  name: string;
}

export interface RosterClassification {
  skaters: Subject[];
  /** Goalies stay in the saved roster; they are only left out of skater evaluation (spec §3.2). */
  goalies: ExcludedGoalie[];
}

/** A goalie when every effective (override-aware) position is G. Players with no positions are not goalies. */
const isGoalie = (positions: readonly string[]) => positions.length > 0 && positions.every((p) => p === 'G');

function subjectFor(base: Omit<Subject, 'status' | 'stats'>, stats: StatsIndex): Subject {
  if (base.nhlId === undefined) return { ...base, status: 'unmatched' };
  const line = stats.get(base.nhlId);
  return line ? { ...base, status: 'ok', stats: line } : { ...base, status: 'no-games' };
}

/** Split the saved roster into skater subjects and excluded goalies. Order follows the roster; nothing is mutated. */
export function classifyRoster(entries: readonly RosterEntry[], resolve: (id: string) => Player | undefined, stats: StatsIndex): RosterClassification {
  const skaters: Subject[] = [];
  const goalies: ExcludedGoalie[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const player = resolve(entry.playerId);
    if (!player) {
      skaters.push({ source: 'roster', playerId: entry.playerId, name: entry.playerId, status: 'unknown-player', onIr: entry.onIr });
      continue;
    }
    if (seen.has(player.id)) continue; // two saved ids resolving to one player (id migration)
    seen.add(player.id);
    if (isGoalie(effectivePositions(entry, player))) {
      goalies.push({ playerId: entry.playerId, name: player.name });
      continue;
    }
    skaters.push(subjectFor({ source: 'roster', playerId: entry.playerId, nhlId: player.nhlId, name: player.name, onIr: entry.onIr }, stats));
  }
  return { skaters, goalies };
}

export interface ComparisonResult {
  subjects: Subject[];
  /** Requested ids that are already roster skaters; they're shown once, as roster players. */
  alreadyOnRoster: number[];
}

/**
 * External NHL skaters added for comparison (not roster additions). Names come
 * from the stats line; an id without one is reported as `no-games`, unnamed.
 */
export function comparisonSubjects(nhlIds: readonly number[], stats: StatsIndex, rosterNhlIds: ReadonlySet<number>): ComparisonResult {
  const subjects: Subject[] = [];
  const alreadyOnRoster: number[] = [];
  const seen = new Set<number>();
  for (const id of nhlIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (rosterNhlIds.has(id)) {
      alreadyOnRoster.push(id);
      continue;
    }
    const line = stats.get(id);
    subjects.push(line ? { source: 'comparison', nhlId: id, name: line.name, status: 'ok', stats: line } : { source: 'comparison', nhlId: id, name: `NHL player ${id}`, status: 'no-games' });
  }
  return { subjects, alreadyOnRoster };
}

/** NHL ids of roster skaters that resolved to a directory player with an NHL id (used for roster indicators). */
export function rosterNhlIds(skaters: readonly Subject[]): Set<number> {
  return new Set(skaters.filter((s) => s.source === 'roster' && s.nhlId !== undefined).map((s) => s.nhlId!));
}

// ---------------------------------------------------------------------------
// Benchmark

export type BenchmarkChoice = { kind: 'league-max' } | { kind: 'roster-max' } | { kind: 'player'; nhlId: number } | { kind: 'custom'; gamesPlayed: number };

/** The default benchmark: the highest GP among all skaters in the season's stats (owner decision, 2026-11-21). */
export const DEFAULT_BENCHMARK: BenchmarkChoice = { kind: 'league-max' };

/**
 * What the benchmark GP came from, so it can be labelled: the league-wide highest GP (the default,
 * and the fallback for roster-max when no rostered skater has stats), the roster's highest GP, a
 * chosen player, or a custom value.
 */
export type BenchmarkBasis = 'roster-max' | 'league-max' | 'player' | 'custom';

export type Benchmark =
  | { available: true; gamesPlayed: number; choice: BenchmarkChoice; basis: BenchmarkBasis; /** Who set it (roster-max / player). */ nhlId?: number; name?: string }
  | { available: false; choice: BenchmarkChoice; reason: 'no-stats' | 'player-has-no-stats' | 'invalid-custom' };

/**
 * Regular-season games per team in the current NHL season (84 in 2026–27): the upper limit for a
 * custom benchmark. Player Evaluator only covers the current season; update this if the format changes.
 */
export const SEASON_GAMES = 84;

/**
 * League max (the default): highest GP among all skaters in the snapshot (skaters only, so no
 * goalies). Roster max: highest GP among roster skaters with stats, IR players included (ties:
 * first in roster order); with no rostered skater stats it falls back to league max (basis
 * 'league-max' while the choice stays 'roster-max', so the UI can say so). Player: that skater's
 * GP. Custom: a whole number from 1 to SEASON_GAMES.
 */
export function resolveBenchmark(choice: BenchmarkChoice, rosterSkaters: readonly Subject[], stats: StatsIndex): Benchmark {
  if (choice.kind === 'custom') {
    const gp = choice.gamesPlayed;
    return Number.isInteger(gp) && gp >= 1 && gp <= SEASON_GAMES
      ? { available: true, gamesPlayed: gp, choice, basis: 'custom' }
      : { available: false, choice, reason: 'invalid-custom' };
  }
  if (choice.kind === 'player') {
    const line = stats.get(choice.nhlId);
    return line
      ? { available: true, gamesPlayed: line.gamesPlayed, choice, basis: 'player', nhlId: line.nhlId, name: line.name }
      : { available: false, choice, reason: 'player-has-no-stats' };
  }
  let best: Subject | undefined;
  if (choice.kind === 'roster-max') {
    for (const s of rosterSkaters) {
      if (s.source === 'roster' && s.status === 'ok' && s.stats && (!best || s.stats.gamesPlayed > best.stats!.gamesPlayed)) best = s;
    }
  }
  if (best) return { available: true, gamesPlayed: best.stats!.gamesPlayed, choice, basis: 'roster-max', nhlId: best.nhlId, name: best.name };
  let leagueMax = 0;
  for (const line of stats.values()) leagueMax = Math.max(leagueMax, line.gamesPlayed);
  return leagueMax > 0 ? { available: true, gamesPlayed: leagueMax, choice, basis: 'league-max' } : { available: false, choice, reason: 'no-stats' };
}

// ---------------------------------------------------------------------------
// Evaluation rows

export interface EvaluatedSubject extends Subject {
  /** Adjusted counting stats; null when the subject has no stats or the benchmark is unavailable. */
  adjusted: Record<ScaledStatKey, number> | null;
}

export function evaluateSubject(subject: Subject, benchmark: Benchmark): EvaluatedSubject {
  if (subject.status !== 'ok' || !subject.stats || !benchmark.available) return { ...subject, adjusted: null };
  const s = subject.stats;
  const adjusted = {} as Record<ScaledStatKey, number>;
  for (const key of SCALED_STATS) adjusted[key] = adjustedValue(s[key], s.gamesPlayed, benchmark.gamesPlayed)!;
  return { ...subject, adjusted };
}

export interface EvaluationInput {
  roster: readonly RosterEntry[];
  resolve: (id: string) => Player | undefined;
  stats: StatsIndex;
  comparisons?: readonly number[];
  benchmark?: BenchmarkChoice;
}

export interface Evaluation {
  benchmark: Benchmark;
  roster: EvaluatedSubject[];
  comparisons: EvaluatedSubject[];
  goalies: ExcludedGoalie[];
  alreadyOnRoster: number[];
}

/** Whole roster evaluation: roster skaters, comparison players, excluded goalies and the benchmark. */
export function evaluatePlayers(input: EvaluationInput): Evaluation {
  const { skaters, goalies } = classifyRoster(input.roster, input.resolve, input.stats);
  const { subjects, alreadyOnRoster } = comparisonSubjects(input.comparisons ?? [], input.stats, rosterNhlIds(skaters));
  const benchmark = resolveBenchmark(input.benchmark ?? DEFAULT_BENCHMARK, skaters, input.stats);
  return {
    benchmark,
    roster: skaters.map((s) => evaluateSubject(s, benchmark)),
    comparisons: subjects.map((s) => evaluateSubject(s, benchmark)),
    goalies,
    alreadyOnRoster,
  };
}

// ---------------------------------------------------------------------------
// League-wide rankings (data only; presentation and prominence are open)

/** Default minimum games played for league-wide rankings (adjustable). Roster evaluation has no minimum. */
export const DEFAULT_RANKING_MIN_GP = 10;

/**
 * Statistics available as ranking categories: every V1 statistic except games played (the
 * denominator). PIM and +/- are included and, like the others, can be sorted either way:
 * a ranking is a statistical ordering, not a claim that higher is better for fantasy.
 */
export const RANKING_STATS: readonly StatKey[] = [...SCALED_STATS, 'plusMinus', 'shootingPct', 'faceoffWinPct', 'toiPerGame'];

export interface RankingOptions {
  stat: StatKey;
  /** Benchmark GP for scaled stats. Required for them; ignored for unchanged stats. */
  benchmarkGp?: number;
  /** NHL ids to flag as on the user's roster (blue-dot indicator in the UI). */
  rosterNhlIds?: ReadonlySet<number>;
  /** Leave out skaters below this many games (default DEFAULT_RANKING_MIN_GP; 1 includes everyone with stats). */
  minGamesPlayed?: number;
  /** NHL position codes (V1 filters by NHL position, not fantasy eligibility). */
  positions?: readonly SkaterPositionCode[];
  /** Default 'desc' (highest first); 'asc' for lowest first. */
  direction?: 'desc' | 'asc';
  /**
   * Which value orders and ranks the rows: the normalized value (default) or the actual,
   * unadjusted total. Displayed values are the same either way.
   */
  sortBy?: 'normalized' | 'actual';
}

export interface RankedPlayer {
  /** Competition ranking (1, 2, 2, 4); null when the value is unavailable (e.g. no shots for shooting %). */
  rank: number | null;
  nhlId: number;
  name: string;
  position: SkaterPositionCode;
  teams: string[];
  gamesPlayed: number;
  actual: number | null;
  /** Adjusted value for scaled stats, the actual value for unchanged ones. */
  value: number | null;
  onRoster: boolean;
}

/**
 * Rank every skater in the snapshot on one statistic. For scaled stats this
 * orders by actual/GP, so the benchmark only changes the displayed values, not
 * the order. Ties share a rank and are listed by GP (desc), name, then id.
 * Unavailable values are listed last, unranked.
 */
export function rankPlayers(skaters: readonly SkaterStatLine[], opts: RankingOptions): RankedPlayer[] {
  const scaled = isScaledStat(opts.stat);
  if (scaled && !(opts.benchmarkGp !== undefined && opts.benchmarkGp > 0)) throw new Error(`rankPlayers: ${opts.stat} needs a positive benchmarkGp`);
  const minGp = opts.minGamesPlayed ?? DEFAULT_RANKING_MIN_GP;
  const positions = opts.positions ? new Set(opts.positions) : undefined;
  const sign = opts.direction === 'asc' ? 1 : -1;
  const rows: RankedPlayer[] = skaters
    .filter((s) => s.gamesPlayed >= minGp && (!positions || positions.has(s.position)))
    .map((s) => {
      const actual = s[opts.stat];
      return {
        rank: null,
        nhlId: s.nhlId,
        name: s.name,
        position: s.position,
        teams: s.teams,
        gamesPlayed: s.gamesPlayed,
        actual,
        value: actual === null ? null : scaled ? adjustedValue(actual, s.gamesPlayed, opts.benchmarkGp) : actual,
        onRoster: opts.rosterNhlIds?.has(s.nhlId) ?? false,
      };
    });
  const key = (r: RankedPlayer) => (opts.sortBy === 'actual' ? r.actual : r.value);
  rows.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x === null || y === null) return x === y ? tieOrder(a, b) : x === null ? 1 : -1;
    return x !== y ? sign * (x - y) : tieOrder(a, b);
  });
  let prev: number | null = null;
  rows.forEach((r, i) => {
    if (key(r) === null) return;
    r.rank = prev !== null && key(rows[i - 1]!) === key(r) ? prev : i + 1;
    prev = r.rank;
  });
  return rows;
}

function tieOrder(a: RankedPlayer, b: RankedPlayer): number {
  return b.gamesPlayed - a.gamesPlayed || a.name.localeCompare(b.name) || a.nhlId - b.nhlId;
}
