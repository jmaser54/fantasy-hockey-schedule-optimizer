/**
 * Build the player directory from NHL rosters (authoritative for identity and
 * team) plus, optionally, ESPN's pool (authoritative for fantasy eligibility).
 */
import { addDays } from '../../domain/dates.ts';
import { normalizeName } from '../../domain/names.ts';
import type { ISODate, Position, TeamStint } from '../../domain/types.ts';
import type { PlayersFile } from '../format.ts';
import { espnPositions, inferSlotMapping, type EspnPlayer } from './espn.ts';
import { NHL_POSITION_TO_FANTASY, type NhlRosterPlayer } from './nhl.ts';

type DirPlayer = PlayersFile['players'][number];

export interface ReconcileResult {
  players: DirPlayer[];
  eligibility: { source: 'espn' | 'nhl'; detail: string };
  report: string[];
  warnings: string[];
}

/** First and last name only, so "Elias N. Pettersson" ~ "Elias Pettersson". */
function looseKey(name: string): string {
  const parts = normalizeName(name).split(' ');
  return parts.length > 2 ? `${parts[0]} ${parts[parts.length - 1]}` : parts.join(' ');
}

function dedupeNhl(players: NhlRosterPlayer[], warnings: string[]): NhlRosterPlayer[] {
  const byId = new Map<number, NhlRosterPlayer>();
  for (const p of players) {
    const prev = byId.get(p.nhlId);
    if (prev && prev.team !== p.team) warnings.push(`${p.name} (${p.nhlId}) is on both ${prev.team} and ${p.team} rosters; keeping ${prev.team}.`);
    if (!prev) byId.set(p.nhlId, p);
  }
  return [...byId.values()];
}

/** Map ESPN proTeamId → NHL team abbreviation using unambiguous name matches. */
function inferProTeams(pairs: { espn: EspnPlayer; nhl: NhlRosterPlayer }[], report: string[]): Map<number, string> {
  const votes = new Map<number, Map<string, number>>();
  for (const { espn, nhl } of pairs) {
    if (espn.proTeamId === 0) continue;
    const m = votes.get(espn.proTeamId) ?? new Map<string, number>();
    m.set(nhl.team, (m.get(nhl.team) ?? 0) + 1);
    votes.set(espn.proTeamId, m);
  }
  const out = new Map<number, string>();
  for (const [id, m] of votes) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [team, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0]!;
    if (total >= 5 && n / total >= 0.8) out.set(id, team);
    else report.push(`proTeamId ${id}: no clear NHL team (${[...m.entries()].map(([t, c]) => `${t}=${c}`).join(' ')})`);
  }
  const teams = [...out.values()];
  if (new Set(teams).size !== teams.length) throw new Error('ESPN: two proTeamIds map to the same NHL team');
  return out;
}

export function reconcilePlayers(input: {
  nhl: NhlRosterPlayer[];
  espn?: EspnPlayer[];
  previous?: PlayersFile;
  /** Refresh date (Eastern); team changes take effect from this date. */
  today: ISODate;
}): ReconcileResult {
  const report: string[] = [];
  const warnings: string[] = [];
  const nhl = dedupeNhl(input.nhl, warnings);
  const nhlByName = new Map<string, NhlRosterPlayer[]>();
  const nhlByLoose = new Map<string, NhlRosterPlayer[]>();
  for (const p of nhl) {
    const k = normalizeName(p.name);
    nhlByName.set(k, [...(nhlByName.get(k) ?? []), p]);
    nhlByLoose.set(looseKey(p.name), [...(nhlByLoose.get(looseKey(p.name)) ?? []), p]);
  }

  const espnFor = new Map<number, EspnPlayer>(); // nhlId → espn
  const espnOnly: EspnPlayer[] = [];
  let eligibility: ReconcileResult['eligibility'] = { source: 'nhl', detail: 'NHL roster positions (ESPN unavailable)' };
  let slotPosition: Map<number, Position> | undefined;
  let proTeams = new Map<number, string>();

  if (input.espn && input.espn.length > 0) {
    try {
      // Pass 1: names that identify exactly one NHL player. Used to learn
      // ESPN's team ids and slot ids before resolving anything ambiguous.
      const firstPass: { espn: EspnPlayer; nhl: NhlRosterPlayer }[] = [];
      const pending: EspnPlayer[] = [];
      for (const e of input.espn) {
        const c = nhlByName.get(normalizeName(e.name)) ?? [];
        if (c.length === 1) firstPass.push({ espn: e, nhl: c[0]! });
        else pending.push(e);
      }
      proTeams = inferProTeams(firstPass, report);
      report.push(`ESPN proTeamIds mapped: ${proTeams.size}`);
      // Several ESPN entries pointing at one NHL player (e.g. a same-named
      // prospect): keep the one on the same team; the rest become pending.
      const byNhl = new Map<number, { espn: EspnPlayer; nhl: NhlRosterPlayer }[]>();
      for (const pr of firstPass) byNhl.set(pr.nhl.nhlId, [...(byNhl.get(pr.nhl.nhlId) ?? []), pr]);
      const pairs: { espn: EspnPlayer; nhl: NhlRosterPlayer }[] = [];
      for (const group of byNhl.values()) {
        if (group.length === 1) {
          pairs.push(group[0]!);
          continue;
        }
        const same = group.filter((g) => proTeams.get(g.espn.proTeamId) === g.nhl.team);
        if (same.length === 1) pairs.push(same[0]!);
        for (const g of group) if (g !== same[0] || same.length !== 1) pending.push(g.espn);
      }
      const inference = inferSlotMapping(pairs.map(({ espn, nhl: n }) => ({ espn, nhlPosition: NHL_POSITION_TO_FANTASY[n.positionCode] })));
      report.push(...inference.report);
      slotPosition = inference.slotPosition;

      // Pass 2: resolve the rest by name (ignoring middle initials), team and position.
      const used = new Set<number>(pairs.map((u) => u.nhl.nhlId));
      for (const e of pending) {
        const key = looseKey(e.name);
        const team = proTeams.get(e.proTeamId);
        const sameName = nhlByLoose.get(key) ?? [];
        const pos = espnPositions(e, slotPosition);
        const c = sameName.filter((p) => p.team === team && !used.has(p.nhlId) && pos.includes(NHL_POSITION_TO_FANTASY[p.positionCode]));
        if (c.length === 1) {
          pairs.push({ espn: e, nhl: c[0]! });
          used.add(c[0]!.nhlId);
        } else if (sameName.some((p) => p.team === team)) {
          // Same name on the same NHL team but not resolvable: never create a second record.
          warnings.push(`ESPN ${e.name} (${e.espnId}) could not be matched to one ${team} player; ignored.`);
        } else {
          espnOnly.push(e);
        }
      }
      // A unique-name match is still the same person if ESPN lags a trade, but say so.
      let teamConflicts = 0;
      for (const { espn, nhl: n } of pairs) {
        const et = proTeams.get(espn.proTeamId);
        if (et && et !== n.team) {
          teamConflicts++;
          if (teamConflicts <= 15) warnings.push(`${n.name}: NHL roster ${n.team}, ESPN ${et}; using NHL.`);
        }
      }
      if (teamConflicts > 15) warnings.push(`…and ${teamConflicts - 15} more ESPN/NHL team conflicts.`);

      for (const { espn, nhl: n } of pairs) espnFor.set(n.nhlId, espn);
      eligibility = { source: 'espn', detail: `ESPN fantasy eligibility for ${pairs.length} players; NHL positions for the rest` };
      report.push(`ESPN matched ${pairs.length}/${input.espn.length}; ESPN-only ${espnOnly.length}; NHL-only ${nhl.length - pairs.length}`);
    } catch (err) {
      warnings.push(`ESPN eligibility not used: ${(err as Error).message}`);
      espnFor.clear();
      espnOnly.length = 0;
      slotPosition = undefined;
    }
  }

  const players: DirPlayer[] = [];
  for (const n of nhl) {
    const e = espnFor.get(n.nhlId);
    const fromEspn = e && slotPosition ? espnPositions(e, slotPosition) : [];
    players.push({
      id: `nhl-${n.nhlId}`,
      name: n.name,
      team: n.team,
      positions: fromEspn.length > 0 ? fromEspn : [NHL_POSITION_TO_FANTASY[n.positionCode]],
      eligibilitySource: fromEspn.length > 0 ? 'espn' : 'nhl',
      nhlId: n.nhlId,
      ...(e ? { espnId: e.espnId } : {}),
      ...(e?.injuryStatus ? { injuryStatus: e.injuryStatus } : {}),
    });
  }
  if (slotPosition) {
    for (const e of espnOnly) {
      const team = proTeams.get(e.proTeamId);
      const positions = espnPositions(e, slotPosition);
      if (!team || positions.length === 0) continue; // free agents / unmapped teams
      players.push({
        id: `espn-${e.espnId}`,
        name: e.name,
        team,
        positions,
        eligibilitySource: 'espn',
        espnId: e.espnId,
        inactive: true,
        ...(e.injuryStatus ? { injuryStatus: e.injuryStatus } : {}),
      });
    }
  }

  applyHistory(players, input.previous, input.today, report);
  players.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { players, eligibility, report, warnings };
}

/**
 * Carry team history forward. A team change since the previous snapshot
 * closes the old stint the day before this refresh and opens a new one
 * today. Players who vanished from all rosters are kept (flagged inactive) so
 * saved rosters still resolve.
 */
export function applyHistory(players: DirPlayer[], previous: PlayersFile | undefined, today: ISODate, report: string[]): void {
  if (!previous) return;
  const prevById = new Map(previous.players.map((p) => [p.id, p]));
  const prevByNhl = new Map(previous.players.filter((p) => p.nhlId !== undefined).map((p) => [p.nhlId!, p]));
  const prevByEspn = new Map(previous.players.filter((p) => p.espnId !== undefined).map((p) => [p.espnId!, p]));
  const consumed = new Set<string>();
  let moves = 0;
  for (const p of players) {
    const prev =
      prevById.get(p.id) ?? (p.nhlId !== undefined ? prevByNhl.get(p.nhlId) : undefined) ?? (p.espnId !== undefined ? prevByEspn.get(p.espnId) : undefined);
    if (!prev) continue;
    consumed.add(prev.id);
    const stints: TeamStint[] = prev.stints ? prev.stints.map((s) => ({ ...s })) : [];
    if (prev.team !== p.team) {
      moves++;
      if (stints.length === 0) stints.push({ team: prev.team });
      const open = stints[stints.length - 1]!;
      open.to = addDays(today, -1);
      stints.push({ team: p.team, from: today });
      report.push(`team change: ${p.name} ${prev.team} → ${p.team} effective ${today}`);
    }
    if (stints.length > 0) p.stints = stints;
  }
  // Keep players who vanished, unless their NHL/ESPN id now belongs to a current record.
  const liveNhl = new Set(players.map((p) => p.nhlId).filter((x) => x !== undefined));
  const liveEspn = new Set(players.map((p) => p.espnId).filter((x) => x !== undefined));
  const kept = previous.players
    .filter((p) => !consumed.has(p.id) && !(p.nhlId !== undefined && liveNhl.has(p.nhlId)) && !(p.espnId !== undefined && liveEspn.has(p.espnId)))
    .map((p) => ({ ...p, inactive: true }));
  players.push(...kept);
  report.push(`team changes: ${moves}; carried forward (not on any current roster): ${kept.length}`);
}
