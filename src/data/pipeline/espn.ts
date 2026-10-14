/**
 * ESPN fantasy hockey player pool (unofficial, undocumented API). Used only
 * for fantasy position eligibility and injury status; NHL data stays
 * authoritative for teams and schedules. ESPN's numeric slot ids are not
 * documented, so we infer which slot id means which position from the data
 * and refuse to use the source if the inference is not clean.
 */
import type { Position } from '../../domain/types.ts';

export const espnPlayersUrl = (espnSeason: number) =>
  `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fhl/seasons/${espnSeason}/players?scoringPeriodId=0&view=players_wl`;

/** ESPN filter header; asks for every active player in the pool. */
export const ESPN_FILTER = JSON.stringify({ filterActive: { value: true } });

export interface EspnPlayer {
  espnId: number;
  name: string;
  proTeamId: number;
  defaultPositionId: number;
  eligibleSlots: number[];
  injuryStatus?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseEspnPlayers(body: unknown): EspnPlayer[] {
  if (!Array.isArray(body)) throw new Error('ESPN: players response is not an array');
  const out: EspnPlayer[] = [];
  for (const p of body) {
    if (!isObj(p)) throw new Error('ESPN: player entry is not an object');
    const { id, fullName, proTeamId, defaultPositionId, eligibleSlots } = p;
    if (typeof id !== 'number' || typeof fullName !== 'string' || typeof proTeamId !== 'number' || typeof defaultPositionId !== 'number' || !Array.isArray(eligibleSlots)) {
      throw new Error(`ESPN: player entry missing required fields (${JSON.stringify(p).slice(0, 200)})`);
    }
    const injuryStatus = typeof p.injuryStatus === 'string' && p.injuryStatus !== 'ACTIVE' ? p.injuryStatus : undefined;
    out.push({ espnId: id, name: fullName, proTeamId, defaultPositionId, eligibleSlots: eligibleSlots.filter((x): x is number => typeof x === 'number'), injuryStatus });
  }
  return out;
}

export interface SlotInference {
  /** ESPN default position id → fantasy position. */
  defaultPosition: Map<number, Position>;
  /** ESPN slot id → the single fantasy position it represents. */
  slotPosition: Map<number, Position>;
  report: string[];
}

/**
 * Infer ESPN ids from players already matched to NHL records.
 *
 * defaultPositionId → position: majority NHL position among matched players.
 * slot id → position: a slot that (nearly) every player of exactly one
 * default position has. Multi-position slots (UTIL, F, bench, IR) cover
 * several positions and are therefore ignored.
 */
export function inferSlotMapping(matched: { espn: EspnPlayer; nhlPosition: Position }[]): SlotInference {
  const report: string[] = [];
  const votes = new Map<number, Map<Position, number>>();
  for (const { espn, nhlPosition } of matched) {
    const m = votes.get(espn.defaultPositionId) ?? new Map<Position, number>();
    m.set(nhlPosition, (m.get(nhlPosition) ?? 0) + 1);
    votes.set(espn.defaultPositionId, m);
  }
  const defaultPosition = new Map<number, Position>();
  for (const [id, m] of votes) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [best, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0]!;
    // Wingers are often listed at C by one source and W by another; require a clear majority.
    if (total >= 10 && n / total >= 0.6) defaultPosition.set(id, best);
    report.push(`defaultPositionId ${id}: ${[...m.entries()].map(([p, c]) => `${p}=${c}`).join(' ')} → ${defaultPosition.get(id) ?? 'unmapped'}`);
  }
  if (new Set(defaultPosition.values()).size !== defaultPosition.size) throw new Error('ESPN: two default position ids map to the same position');

  // Coverage: for each slot id, which default positions (nearly) always have it.
  const byPos = new Map<Position, EspnPlayer[]>();
  for (const { espn } of matched) {
    const pos = defaultPosition.get(espn.defaultPositionId);
    if (!pos) continue;
    byPos.set(pos, [...(byPos.get(pos) ?? []), espn]);
  }
  const slotIds = new Set(matched.flatMap((m) => m.espn.eligibleSlots));
  const slotPosition = new Map<number, Position>();
  for (const slot of [...slotIds].sort((a, b) => a - b)) {
    const covered: Position[] = [];
    for (const [pos, list] of byPos) {
      const share = list.filter((p) => p.eligibleSlots.includes(slot)).length / list.length;
      if (share >= 0.95) covered.push(pos);
    }
    if (covered.length === 1) slotPosition.set(slot, covered[0]!);
    report.push(`slot ${slot}: covers ${covered.join('/') || 'none'}${covered.length === 1 ? ` → ${covered[0]}` : ''}`);
  }
  const mapped = new Set(slotPosition.values());
  for (const pos of ['C', 'LW', 'RW', 'D', 'G'] as const) {
    if (!mapped.has(pos)) throw new Error(`ESPN: could not identify the slot id for ${pos}`);
  }
  if (mapped.size !== slotPosition.size) throw new Error('ESPN: several slot ids map to the same position');
  return { defaultPosition, slotPosition, report };
}

export function espnPositions(p: EspnPlayer, slotPosition: ReadonlyMap<number, Position>): Position[] {
  const order: Position[] = ['C', 'LW', 'RW', 'D', 'G'];
  const set = new Set<Position>();
  for (const s of p.eligibleSlots) {
    const pos = slotPosition.get(s);
    if (pos) set.add(pos);
  }
  return order.filter((x) => set.has(x));
}
