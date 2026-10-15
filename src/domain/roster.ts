import type { LineupPlayer } from './optimizer.ts';
import type { LeagueConfig, Player, Position, RosterEntry } from './types.ts';

export type RosterIssue =
  | { kind: 'over-roster'; count: number; limit: number }
  | { kind: 'over-ir'; count: number; limit: number }
  | { kind: 'ir-ineligible'; playerId: string; name: string }
  | { kind: 'unknown-player'; playerId: string }
  | { kind: 'no-positions'; playerId: string; name: string };

export function effectivePositions(entry: RosterEntry, player: Player): Position[] {
  return entry.positionsOverride && entry.positionsOverride.length > 0 ? entry.positionsOverride : player.positions;
}

export function isInjured(entry: RosterEntry, player: Player): boolean {
  return Boolean(entry.markedInjured || player.injuryStatus);
}

export function canUseIr(entry: RosterEntry, player: Player, league: LeagueConfig): boolean {
  return league.irEligibility === 'any' || isInjured(entry, player);
}

/**
 * Validate a roster against the league. IR slots are in addition to the
 * roster size: rosterSize non-IR players plus irSlots IR players. Nothing is
 * removed here; issues are reported for the user to resolve.
 */
export function validateRoster(
  entries: readonly RosterEntry[],
  players: ReadonlyMap<string, Player>,
  league: LeagueConfig,
): RosterIssue[] {
  const issues: RosterIssue[] = [];
  const active = entries.filter((e) => !e.onIr);
  const ir = entries.filter((e) => e.onIr);
  if (active.length > league.rosterSize) issues.push({ kind: 'over-roster', count: active.length, limit: league.rosterSize });
  if (ir.length > league.irSlots) issues.push({ kind: 'over-ir', count: ir.length, limit: league.irSlots });
  for (const e of entries) {
    const p = players.get(e.playerId);
    if (!p) {
      issues.push({ kind: 'unknown-player', playerId: e.playerId });
      continue;
    }
    if (e.onIr && !canUseIr(e, p, league)) issues.push({ kind: 'ir-ineligible', playerId: p.id, name: p.name });
    if (effectivePositions(e, p).length === 0) issues.push({ kind: 'no-positions', playerId: p.id, name: p.name });
  }
  return issues;
}

export function describeIssue(issue: RosterIssue): string {
  switch (issue.kind) {
    case 'over-roster':
      return `${issue.count} players on the roster; the limit is ${issue.limit}. Drop players or move eligible ones to IR.`;
    case 'over-ir':
      return `${issue.count} players on IR; the league allows ${issue.limit}.`;
    case 'ir-ineligible':
      return `${issue.name} isn't marked injured, so they can't use an IR slot under this league's rules.`;
    case 'unknown-player':
      return `A rostered player (${issue.playerId}) is missing from the current player data.`;
    case 'no-positions':
      return `${issue.name} has no eligible positions.`;
  }
}

/** Convert roster entries into optimizer input. Unknown players are skipped (and reported by validateRoster). */
export function toLineupPlayers(entries: readonly RosterEntry[], players: ReadonlyMap<string, Player>): LineupPlayer[] {
  const out: LineupPlayer[] = [];
  for (const e of entries) {
    const p = players.get(e.playerId);
    if (!p) continue;
    out.push({ id: p.id, name: p.name, team: p.team, stints: p.stints, positions: effectivePositions(e, p), onIr: e.onIr, ...(e.preferred ? { preferred: true } : {}) });
  }
  return out;
}
