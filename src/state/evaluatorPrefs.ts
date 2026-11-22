import { DEFAULT_BENCHMARK, DEFAULT_RANKING_MIN_GP, SEASON_GAMES, type BenchmarkChoice } from '../domain/evaluator.ts';

/**
 * Player Evaluator preferences: comparison players, the selected benchmark and the rankings'
 * minimum games played. Kept in their own
 * browser-storage key, separate from the saved fantasy roster (`playoff-optimizer:v1`), so changing
 * them never touches the roster and the roster's persistence model is unchanged. The live and testing
 * sites share one browser storage, so the testing build uses its own key, as for the app state.
 *
 * Benchmarks are stored as the choice (league max, roster max, a player), never as a GP number, so
 * they keep following the data. A custom benchmark is stored as the user's number; its upper limit is
 * checked when it is resolved.
 *
 * Version 2 (2026-11-21) made league max the default. Version 1 always saved its default, roster max,
 * so a version-1 roster-max can't be told apart from "never chose" and loads as the new default;
 * version-1 player and custom choices were explicit and are kept.
 */
export function evaluatorPrefsKeyFor(baseUrl: string): string {
  return /\/fantasy-hockey-schedule-optimizer-testing\/$/.test(baseUrl) ? 'playoff-evaluator-testing:v1' : 'playoff-evaluator:v1';
}
export const EVALUATOR_PREFS_KEY = evaluatorPrefsKeyFor((import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/');
export const EVALUATOR_PREFS_VERSION = 2;

export interface EvaluatorPrefs {
  version: number;
  /** NHL ids of comparison players, in the order added. Not part of the fantasy roster. */
  comparisons: number[];
  benchmark: BenchmarkChoice;
  /** League-wide rankings leave out skaters below this many games. */
  minGamesPlayed: number;
}

export function defaultEvaluatorPrefs(): EvaluatorPrefs {
  return { version: EVALUATOR_PREFS_VERSION, comparisons: [], benchmark: DEFAULT_BENCHMARK, minGamesPlayed: DEFAULT_RANKING_MIN_GP };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

function loadBenchmark(v: unknown): BenchmarkChoice | undefined {
  if (!isObj(v)) return undefined;
  if (v.kind === 'league-max') return { kind: 'league-max' };
  if (v.kind === 'roster-max') return { kind: 'roster-max' };
  if (v.kind === 'per-game') return { kind: 'per-game' };
  if (v.kind === 'player' && isId(v.nhlId)) return { kind: 'player', nhlId: v.nhlId };
  if (v.kind === 'custom' && Number.isInteger(v.gamesPlayed) && (v.gamesPlayed as number) >= 1) return { kind: 'custom', gamesPlayed: v.gamesPlayed as number };
  return undefined;
}

/** Tolerant: anything unreadable falls back to the defaults, field by field. */
export function parseEvaluatorPrefs(raw: string | null): EvaluatorPrefs {
  const base = defaultEvaluatorPrefs();
  if (!raw) return base;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!isObj(data)) return base;
  const comparisons = Array.isArray(data.comparisons) ? [...new Set(data.comparisons.filter(isId))] : base.comparisons;
  const minGp = data.minGamesPlayed;
  const minGamesPlayed = Number.isInteger(minGp) && (minGp as number) >= 1 && (minGp as number) <= SEASON_GAMES ? (minGp as number) : base.minGamesPlayed;
  let benchmark = loadBenchmark(data.benchmark) ?? base.benchmark;
  if (benchmark.kind === 'roster-max' && !(typeof data.version === 'number' && data.version >= 2)) benchmark = base.benchmark;
  return { ...base, comparisons, benchmark, minGamesPlayed };
}

/**
 * Remove every comparison player. The saved roster is a different key and is never touched. If the
 * benchmark was one of the cleared players, it returns to the default (league max).
 */
export function clearComparisons(prefs: EvaluatorPrefs): EvaluatorPrefs {
  return { ...prefs, comparisons: [], benchmark: prefs.benchmark.kind === 'player' ? DEFAULT_BENCHMARK : prefs.benchmark };
}

export function serializeEvaluatorPrefs(prefs: EvaluatorPrefs): string {
  return JSON.stringify({ version: EVALUATOR_PREFS_VERSION, comparisons: prefs.comparisons, benchmark: prefs.benchmark, minGamesPlayed: prefs.minGamesPlayed });
}

export function loadEvaluatorPrefs(key = EVALUATOR_PREFS_KEY): EvaluatorPrefs {
  try {
    return parseEvaluatorPrefs(globalThis.localStorage?.getItem(key) ?? null);
  } catch {
    return defaultEvaluatorPrefs();
  }
}

export function saveEvaluatorPrefs(prefs: EvaluatorPrefs, key = EVALUATOR_PREFS_KEY): boolean {
  try {
    globalThis.localStorage?.setItem(key, serializeEvaluatorPrefs(prefs));
    return true;
  } catch {
    return false;
  }
}
