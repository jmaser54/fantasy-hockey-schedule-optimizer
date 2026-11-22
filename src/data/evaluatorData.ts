import { buildStatsIndex, evaluatePlayers, rosterNhlIds, type BenchmarkChoice, type Evaluation, type StatsIndex } from '../domain/evaluator.ts';
import type { Player, RosterEntry } from '../domain/types.ts';
import { skaterStatsPath, type SkaterStatsFile } from './format.ts';
import { buildPlayerLookup } from './load.ts';
import { validateSkaterStats } from './validate.ts';

/**
 * Player Evaluator's connection to the saved roster and the skater-stats snapshot. It reads the
 * saved roster (`AppState.roster`, the same entries the Roster tab edits) and never writes it.
 * Not yet used by the UI.
 */

/** Validate a fetched `skater-stats.json`; throws on the first error, like `buildDataset`. */
export function buildSkaterStats(raw: unknown, opts: { season?: string; teamIds?: ReadonlySet<string>; completeSeasonGames?: number } = {}): SkaterStatsFile {
  const v = validateSkaterStats(raw, opts);
  if (v.errors.length) throw new Error(`Skater stats failed validation: ${v.errors[0]}`);
  return raw as SkaterStatsFile;
}

/**
 * Fetch and validate the stats snapshot. Separate from `loadDataset`, so a stats problem can never stop the planner loading.
 * `historical` loads a completed season's static snapshot (`skater-stats-<season>.json`, which must be complete).
 */
export async function loadSkaterStats(
  base = import.meta.env.BASE_URL,
  opts: { season?: string; teamIds?: ReadonlySet<string>; historical?: { teamGames: number } } = {},
): Promise<SkaterStatsFile> {
  const url = `${base}${skaterStatsPath(opts.historical ? opts.season : undefined)}`;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return buildSkaterStats(await res.json(), { season: opts.season, teamIds: opts.teamIds, completeSeasonGames: opts.historical?.teamGames });
}

export interface SavedRosterEvaluation {
  evaluation: Evaluation;
  /** For league-wide rankings (`rankPlayers`). */
  stats: StatsIndex;
  /** Rostered skaters' NHL ids, for the on-roster (blue dot) flag in rankings. */
  rosterNhlIds: Set<number>;
  season: string;
  statsFetchedAt: string;
}

/**
 * Evaluate the saved roster. `saved` is the persisted app state (or just its roster and custom
 * players); `players` is the bundled player directory. Comparison players and the benchmark come
 * from the evaluator's own preferences, never from the roster.
 */
export function evaluateSavedRoster(
  saved: { roster: readonly RosterEntry[]; customPlayers: readonly Player[] },
  players: readonly Player[],
  statsFile: SkaterStatsFile,
  prefs: { comparisons?: readonly number[]; benchmark?: BenchmarkChoice } = {},
): SavedRosterEvaluation {
  const { resolve } = buildPlayerLookup(players, saved.customPlayers);
  const stats = buildStatsIndex(statsFile.skaters);
  const evaluation = evaluatePlayers({ roster: saved.roster, resolve, stats, comparisons: prefs.comparisons, benchmark: prefs.benchmark });
  return { evaluation, stats, rosterNhlIds: rosterNhlIds(evaluation.roster), season: statsFile.season, statsFetchedAt: statsFile.fetchedAt };
}
