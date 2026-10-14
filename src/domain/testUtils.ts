import type { LineupPlayer } from './optimizer.ts';
import { ScheduleIndex } from './schedule.ts';
import type { Game, LineupSlot, Position } from './types.ts';

let gameSeq = 0;

/** Build a schedule from "date: HOME-AWAY, HOME-AWAY" style tuples. */
export function sched(entries: [string, string, string][]): ScheduleIndex {
  const games: Game[] = entries.map(([date, home, away]) => ({ id: `g${++gameSeq}`, date, home, away }));
  return new ScheduleIndex(games);
}

export function player(id: string, team: string, positions: Position[], onIr = false): LineupPlayer {
  return { id, name: id, team, positions, onIr };
}

export function slots(spec: Record<string, Position[] | [number, Position[]]>): LineupSlot[] {
  return Object.entries(spec).map(([id, v]) => {
    const [count, accepts] = typeof v[0] === 'number' ? (v as [number, Position[]]) : [1, v as Position[]];
    return { id, label: id, count, accepts };
  });
}
