import { createContext, useContext, type Dispatch } from 'react';
import type { Dataset } from '../data/load.ts';
import type { DayResult, LineupPlayer, RangeResult } from '../domain/optimizer.ts';
import type { ISODate, Player, Team } from '../domain/types.ts';
import type { Action, AppState } from '../state/appState.ts';

/** A date window the user can analyze: a round, the full playoffs or a custom range. */
export interface Window {
  id: string;
  name: string;
  start: ISODate;
  end: ISODate;
  dates: ISODate[];
}

export interface AppCtx {
  state: AppState;
  dispatch: Dispatch<Action>;
  data: Dataset;
  resolve: (id: string) => Player | undefined;
  teams: Map<string, Team>;
  windows: Window[]; // rounds…, all, custom
  selected: Window;
  lineupPlayers: LineupPlayer[];
  /** Results for every date in any window, with manual lineups applied. */
  days: Map<ISODate, DayResult>;
  summarizeWindow: (w: Window, days?: Map<ISODate, DayResult>, roster?: LineupPlayer[]) => RangeResult;
  toast: (msg: string) => void;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}
