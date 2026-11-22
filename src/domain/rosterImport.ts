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
  /** First initial + rest of the name ("c mcdavid"), built from the directory: one player means unique. */
  byInitial: Map<string, Player[]>;
  /**
   * Names with ä/ö/ü, as patterns that also accept the usual OCR and typing variants of the umlaut
   * ("Stiitzle", "Stitzle", "Stuetzle"): the full name, and the initial + rest form.
   */
  umlauts: { full: RegExp; initial: RegExp; player: Player }[];
}

const UMLAUT_VARIANTS: Record<string, string> = { ü: '(?:ue|ii|ti|li|il|u|i|y)', ö: '(?:oe|o|0|6)', ä: '(?:ae|a|4)' };

/** "Tim Stützle" → patterns for "tim stützle"-like full names and "t stützle"-like initial forms. */
function umlautPatterns(name: string): { full: RegExp; initial: RegExp } | undefined {
  const lower = name.toLowerCase();
  if (!/[äöü]/.test(lower)) return undefined;
  // Keep the umlauts as placeholders through normalizeName (which would turn them into plain vowels).
  const marked = normalizeName(lower.replace(/ü/g, '1').replace(/ö/g, '2').replace(/ä/g, '3'));
  const toRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/1/g, UMLAUT_VARIANTS.ü!).replace(/2/g, UMLAUT_VARIANTS.ö!).replace(/3/g, UMLAUT_VARIANTS.ä!);
  const parts = marked.split(' ');
  return { full: new RegExp(`^${toRe(marked)}$`), initial: new RegExp(`^${toRe(parts[0]![0]!)} ${toRe(parts.slice(1).join(' '))}$`) };
}

/** First initial + the rest of a normalized name: "connor mcdavid" → "c mcdavid", "tj hughes" → "t hughes". */
function initialKey(normalized: string): string | undefined {
  const parts = normalized.split(' ');
  return parts.length >= 2 ? `${parts[0]![0]} ${parts.slice(1).join(' ')}` : undefined;
}

export function buildPlayerIndex(players: readonly Player[]): PlayerIndex {
  const byName = new Map<string, Player[]>();
  const byInitial = new Map<string, Player[]>();
  const umlauts: PlayerIndex['umlauts'] = [];
  for (const p of players) {
    const k = normalizeName(p.name);
    byName.set(k, [...(byName.get(k) ?? []), p]);
    const ik = initialKey(k);
    if (ik) byInitial.set(ik, [...(byInitial.get(ik) ?? []), p]);
    const u = umlautPatterns(p.name);
    if (u) umlauts.push({ ...u, player: p });
  }
  return { byName, all: [...players], byInitial, umlauts };
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

// ---------------------------------------------------------------------------
// Whole-page import (paste or screenshot text)

/** A player name found in imported text, with how sure the match is. */
export interface FoundName {
  /** The source line, for display. */
  raw: string;
  /** The name as it appeared. */
  name: string;
  teamHint?: TeamId;
  result: MatchResult;
  /** A suggestion with a single candidate is pre-selected for the user to confirm. */
  preselect?: string;
}

export interface ExtractedRoster {
  /** Exact, unambiguous players, de-duplicated, in page order. */
  matched: Player[];
  /** Names the user must look at: same-name players, or near matches (OCR errors, typos, "C. McDavid"). */
  review: FoundName[];
  /** Name-like text that matched no player (e.g. someone not in the directory). Never imported. */
  unrecognized: string[];
  /** How many lines were ignored as non-player text (headings, stats, menus). */
  ignored: number;
}

const NAME_TOKEN = /^(?:[A-ZÀ-Þ][A-Za-zÀ-ÿ'’.-]*|[A-Z]\.)$/;
/** Words that make a name-like phrase obviously page furniture rather than a missing player. */
const PAGE_WORDS = new Set(
  'my team teams roster rosters player players league leagues week weeks today daily season stats points point total totals period scoring waiver waivers position positions free agent agents trade trades lineup lineups edit move bench starters reserve reserves injured matchup matchups schedule settings standings news research projections projected opponent opp status fantasy hockey home add drop players skaters goalies forwards defense active the of and in on at vs final pm am'.split(' '),
);

function lineTokens(line: string): string[] {
  return line
    .replace(/[•·|\t()[\]{}]/g, ' ')
    .replace(/\b([A-Z])\.(?=[A-Za-zÀ-ÿ])/g, '$1. ') // OCR often drops the space after an initial ("A.Fox")
    .split(/\s+/)
    .map((t) => t.replace(/^[^A-Za-zÀ-ÿ0-9@]+|[^A-Za-zÀ-ÿ0-9.,'’]+$/g, ''))
    .filter(Boolean);
}

function teamNear(tokens: string[], from: number, teamIds: ReadonlySet<TeamId>): TeamId | undefined {
  for (let i = from; i < Math.min(tokens.length, from + 3); i++) {
    const t = tokens[i]!;
    // "@TOR", "vs Det", "at BOS" name the opponent, not the player's team: stop looking.
    if (t.startsWith('@') || /^(?:vs\.?|at|v)$/i.test(t)) return undefined;
    const w = t.replace(/[^A-Za-z]/g, '');
    const up = w.toUpperCase();
    // Team codes appear as "EDM" or "Edm"; anything else (a garbled OCR token) gives no hint.
    if (teamIds.has(up) && (w === up || w === up[0] + up.slice(1).toLowerCase())) return up;
  }
  return undefined;
}

/**
 * Find player names anywhere in pasted or OCR'd text: a whole roster page with headings, slots,
 * stats and menus. Exact (normalized) full names, including "Last, First", are found inside each
 * line; nothing looser is accepted without the user. Lines with no exact name are checked for a
 * name-like phrase that is close to a player (a typo, OCR error or "C. McDavid"); those go to review.
 * Everything else is ignored, except name-like phrases, which are listed as unrecognized.
 */
export function extractRosterNames(text: string, index: PlayerIndex, teamIds: ReadonlySet<TeamId>): ExtractedRoster {
  const lines = text
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);
  const matched = new Map<string, Player>();
  const review = new Map<string, FoundName>();
  const unrecognized = new Set<string>();
  let ignored = 0;
  const addFound = (raw: string, name: string, teamHint: TeamId | undefined, result: MatchResult, initialForm = false) => {
    if (result.status === 'matched') {
      matched.set(result.player.id, result.player);
      return;
    }
    // The same player(s) can appear differently on several screenshots ("Elias Pettersson",
    // "Pettersson, Elias", "Tim Stiitzle" with and without a team): one review row per candidate set.
    const key = result.status === 'unmatched' ? normalizeName(name) : result.candidates.map((c) => c.id).sort().join(',');
    if (review.has(key)) return;
    let preselect: string | undefined;
    if (result.status === 'suggested' || (result.status === 'ambiguous' && initialForm)) {
      const onTeam = teamHint ? result.candidates.filter((c) => c.team === teamHint) : [];
      preselect = result.candidates.length === 1 ? result.candidates[0]!.id : onTeam.length === 1 ? onTeam[0]!.id : undefined;
    }
    review.set(key, { raw, name, ...(teamHint ? { teamHint } : {}), result, ...(preselect ? { preselect } : {}) });
  };

  for (const raw of lines) {
    const tokens = lineTokens(raw);
    let found = false;
    // 1. Exact full names inside the line (longest first), also "Last, First".
    for (let i = 0; i < tokens.length; i++) {
      for (let k = Math.min(4, tokens.length - i); k >= 2; k--) {
        const span = tokens.slice(i, i + k);
        let key = normalizeName(span.join(' '));
        if (!index.byName.has(key) && span[0]!.endsWith(',')) key = normalizeName([...span.slice(1), span[0]].join(' '));
        if (!index.byName.has(key)) {
          // An umlaut name read with a variant ("Tim Stiitzle"): accepted when exactly one player fits.
          const u = index.umlauts.filter((x) => x.full.test(key));
          if (u.length !== 1) continue;
          key = normalizeName(u[0]!.player.name);
        }
        const name = span.join(' ').replace(/,$/, '');
        const teamHint = teamNear(tokens, i + k, teamIds);
        // A unique exact name is accepted whatever the nearby team says (the directory's team can lag a
        // trade); the team only chooses between players who share a name.
        const same = index.byName.get(key)!;
        addFound(raw, name, teamHint, same.length === 1 ? { status: 'matched', player: same[0]! } : matchName(key, index, teamHint));
        found = true;
        i += k - 1;
        break;
      }
    }
    if (found) continue;
    // 2. First initial + last name ("C. McDavid", OCR "C McDavid" or "GD. Tarasov" with the slot run in):
    // automatic when the directory has exactly one such player, a review when several share it.
    for (let i = 0; i < tokens.length && !found; i++) {
      const init = /^(?:[A-Z]{0,2}([A-Z])\.|([ABEHIJKLMNOPQRSTVXYZ]))$/.exec(tokens[i]!);
      if (!init) continue;
      for (let k = Math.min(3, tokens.length - i - 1); k >= 1; k--) {
        const rest = normalizeName(tokens.slice(i + 1, i + 1 + k).join(' '));
        if (!rest || /\d/.test(rest)) continue;
        const key = `${(init[1] ?? init[2])!.toLowerCase()} ${rest}`;
        let same = index.byInitial.get(key) ?? [];
        if (same.length === 0) {
          const u = index.umlauts.filter((x) => x.initial.test(key));
          if (u.length === 1) same = [u[0]!.player];
        }
        if (same.length === 0) continue;
        const name = `${(init[1] ?? init[2])!}. ${tokens.slice(i + 1, i + 1 + k).join(' ')}`;
        const teamHint = teamNear(tokens, i + 1 + k, teamIds);
        // An initial without its dot and with no team beside it ("P Kane said") is weaker evidence: suggest it.
        const sure = !!init[1] || !!teamHint;
        addFound(
          raw,
          name,
          teamHint,
          same.length > 1 ? { status: 'ambiguous', candidates: same } : sure ? { status: 'matched', player: same[0]! } : { status: 'suggested', candidates: same },
          true,
        );
        found = true;
        break;
      }
    }
    if (found) continue;
    // 3. A name-like phrase close to a player (typo, OCR error, initial + misread last name).
    const clean = tokens.map((t) => t.replace(/,$/, ''));
    const runs: { start: number; words: string[] }[] = [];
    let cur: string[] = [];
    clean.forEach((t, i) => {
      const afterInitial = i > 0 && /^[A-Z]\.$/.test(clean[i - 1]!);
      // A lone capital right before a name word may be an initial whose dot OCR lost ("C McDavid"): kept
      // for a suggestion only (step 2 already handled the safe cases).
      const bareInitial = /^[A-Z]$/.test(t) && /^[A-ZÀ-Þ][a-zà-ÿ'’-]+(?:[A-Z][a-zà-ÿ'’-]+)*$/.test(clean[i + 1] ?? '');
      if (bareInitial || (NAME_TOKEN.test(t) && (afterInitial || !(t.length <= 3 && t === t.toUpperCase() && !t.endsWith('.'))))) cur.push(t);
      else {
        if (cur.length) runs.push({ start: i - cur.length, words: cur });
        cur = [];
      }
    });
    if (cur.length) runs.push({ start: clean.length - cur.length, words: cur });
    let suggested = false;
    for (const run of runs) {
      for (let k = Math.min(3, run.words.length); k >= 2 && !suggested; k--) {
        for (let s = 0; s + k <= run.words.length; s++) {
          let words = run.words.slice(s, s + k);
          // "Stiitzle, Tim": a comma after the first word means Last, First.
          if (k === 2 && tokens[run.start + s]!.endsWith(',')) words = [words[1]!, words[0]!];
          if (words.some((w) => PAGE_WORDS.has(w.toLowerCase()))) continue;
          const teamHint = teamNear(clean, run.start + s + k, teamIds);
          const r = matchName(words.join(' '), index, teamHint);
          if (r.status === 'suggested' || r.status === 'ambiguous') {
            addFound(raw, words.join(' '), teamHint, r);
            suggested = true;
            break;
          }
        }
      }
      if (suggested) break;
    }
    if (suggested) continue;
    // 4. A lone surname typed on its own line ("Hughes") is still offered as a suggestion.
    if (tokens.length === 1 && NAME_TOKEN.test(tokens[0]!) && !PAGE_WORDS.has(tokens[0]!.toLowerCase())) {
      const r = matchName(tokens[0]!, index);
      if (r.status === 'suggested') {
        addFound(raw, tokens[0]!, undefined, r);
        continue;
      }
    }
    const nameLike = runs.find((r) => r.words.length >= 2 && r.words.length <= 3 && !r.words.some((w) => PAGE_WORDS.has(w.toLowerCase()) || w.endsWith('.') || w.length === 1));
    if (nameLike) unrecognized.add(nameLike.words.join(' '));
    ignored++;
  }
  // A near match whose likely player was found exactly elsewhere (another screenshot) is already settled.
  const open = [...review.values()].filter((r) => !(r.preselect && matched.has(r.preselect)));
  return { matched: [...matched.values()], review: open, unrecognized: [...unrecognized], ignored };
}
