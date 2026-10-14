/**
 * Turning pasted or typed names into player records. Only an exact
 * (normalized) full-name match is accepted automatically; anything looser is
 * offered as a suggestion that the user must confirm.
 */
import { editDistance, lastName, normalizeName } from './names.ts';
import type { Player, TeamId } from './types.ts';

export interface ParsedLine {
  raw: string;
  name: string;
  teamHint?: TeamId;
}

const NOISE_TOKEN = /^(?:C|LW|RW|W|F|D|G|UTIL|UT|BN|BE|BENCH|IR|IR\+|O|DTD|Q|SUSP|NA|P|FA|WA)$/i;
const HEADER_LINE = /^(starters|bench|reserves|injured reserve|slot|player|roster|pos|position|team|opp|status|goalies|skaters)\b/i;

/**
 * Split pasted text into candidate names. Handles one-per-line lists,
 * comma/semicolon lists, "Last, First", and lines copied from fantasy sites
 * with slot labels, team abbreviations, positions and injury tags around the
 * name (e.g. "LW  Connor McDavid  EDM  C, LW  DTD").
 */
export function parseRosterText(text: string, teamIds: ReadonlySet<TeamId>): ParsedLine[] {
  let lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && /[;,]/.test(lines[0]!) && !/^[^,]+,\s*[^,\s]+$/.test(lines[0]!)) {
    lines = lines[0]!.split(/[;,]/).map((l) => l.trim()).filter(Boolean);
  } else {
    lines = lines.flatMap((l) => l.split(';').map((x) => x.trim()).filter(Boolean));
  }
  const out: ParsedLine[] = [];
  for (const raw of lines) {
    if (HEADER_LINE.test(raw) && raw.split(/\s+/).length <= 3) continue;
    let line = raw.replace(/\([^)]*\)/g, ' ').replace(/[•·|\t]/g, ' ').replace(/^\d+[.)]\s*/, '');
    // "McDavid, Connor" → "Connor McDavid" (only when the comma separates two name parts)
    const lastFirst = /^([A-Za-zÀ-ÿ.'’ -]+),\s*([A-Za-zÀ-ÿ.'’-]+(?:\s+[A-Za-zÀ-ÿ.'’-]+)?)$/.exec(line.trim());
    if (lastFirst && !teamIds.has(lastFirst[2]!.toUpperCase()) && !NOISE_TOKEN.test(lastFirst[2]!)) {
      line = `${lastFirst[2]} ${lastFirst[1]}`;
    }
    const tokens = line.split(/[\s,/]+|\s+-\s+/).filter(Boolean);
    let teamHint: TeamId | undefined;
    const kept: string[] = [];
    for (const t of tokens) {
      const up = t.toUpperCase();
      if (t === '-' ) continue;
      if (t === up && teamIds.has(up)) {
        teamHint = up;
        continue;
      }
      if (NOISE_TOKEN.test(t) && (t === up || t.length <= 2)) continue;
      if (/^\d+$/.test(t)) continue;
      kept.push(t);
    }
    const name = kept.join(' ').trim();
    if (!/[a-zA-ZÀ-ÿ]{2,}/.test(name)) continue;
    out.push({ raw, name, ...(teamHint ? { teamHint } : {}) });
  }
  return out;
}

export interface PlayerIndex {
  byName: Map<string, Player[]>;
  all: Player[];
}

export function buildPlayerIndex(players: readonly Player[]): PlayerIndex {
  const byName = new Map<string, Player[]>();
  for (const p of players) {
    const k = normalizeName(p.name);
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  return { byName, all: [...players] };
}

export type MatchResult =
  | { status: 'matched'; player: Player }
  | { status: 'ambiguous'; candidates: Player[] }
  | { status: 'suggested'; candidates: Player[] }
  | { status: 'unmatched' };

export function matchName(name: string, index: PlayerIndex, teamHint?: TeamId): MatchResult {
  const n = normalizeName(name);
  if (!n) return { status: 'unmatched' };
  const exact = index.byName.get(n) ?? [];
  if (exact.length > 0) {
    const narrowed = teamHint ? exact.filter((p) => p.team === teamHint) : exact;
    if (narrowed.length === 1) return { status: 'matched', player: narrowed[0]! };
    return { status: 'ambiguous', candidates: narrowed.length > 1 ? narrowed : exact };
  }
  // Looser matches → suggestions only.
  const parts = n.split(' ');
  const last = lastName(n);
  const firstInitial = parts.length > 1 && parts[0]!.length <= 2 ? parts[0]![0] : undefined;
  const scored: { p: Player; score: number }[] = [];
  for (const [key, players] of index.byName) {
    let score = Infinity;
    if (firstInitial && lastName(key) === last && key[0] === firstInitial) score = 0.5;
    else if (parts.length === 1 && lastName(key) === n) score = 1;
    else {
      const d = editDistance(n, key, 2);
      if (d <= 2) score = d;
    }
    if (score === Infinity) continue;
    for (const p of players) scored.push({ p, score: teamHint && p.team === teamHint ? score - 0.25 : score });
  }
  scored.sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name));
  const candidates = scored.slice(0, 6).map((s) => s.p);
  return candidates.length ? { status: 'suggested', candidates } : { status: 'unmatched' };
}

/** Autocomplete: every query token must prefix-match a token of the name. */
export function searchPlayers(query: string, index: PlayerIndex, limit = 8): Player[] {
  const q = normalizeName(query);
  if (q.length < 2) return [];
  const qt = q.split(' ');
  const hits: { p: Player; rank: number }[] = [];
  for (const p of index.all) {
    const n = normalizeName(p.name);
    const nt = n.split(' ');
    if (!qt.every((t) => nt.some((x) => x.startsWith(t)))) continue;
    const rank = n.startsWith(q) ? 0 : lastName(n).startsWith(qt[qt.length - 1]!) ? 1 : 2;
    hits.push({ p, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.p.name.localeCompare(b.p.name));
  return hits.slice(0, limit).map((h) => h.p);
}
