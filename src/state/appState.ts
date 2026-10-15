import { isValidISODate } from '../domain/dates.ts';
import { DEFAULT_LEAGUE, DEFAULT_PERIODS, validateLeague } from '../domain/league.ts';
import { isEmptyOverride, type DayOverride } from '../domain/optimizer.ts';
import { POSITIONS, type ISODate, type LeagueConfig, type Period, type Player, type Position, type RosterEntry } from '../domain/types.ts';

export const STORAGE_KEY = 'playoff-optimizer:v1';
export const STATE_VERSION = 1;

/** Hypothetical roster change, applied on top of the saved roster. */
export interface Scenario {
  drops: string[];
  adds: string[];
}

export type Selection = string; // a period id, 'all' or 'custom'

export interface AppState {
  version: number;
  league: LeagueConfig;
  periods: Period[];
  custom: { start: ISODate; end: ISODate };
  selection: Selection;
  roster: RosterEntry[];
  /** Players the user created because no data record matched. */
  customPlayers: Player[];
  /** The user's start/sit choices by date, for the saved roster. Dates without choices are fully automatic. */
  manual: Record<ISODate, DayOverride>;
  scenario: Scenario;
}

export const EMPTY_SCENARIO: Scenario = { drops: [], adds: [] };

export function initialState(): AppState {
  return {
    version: STATE_VERSION,
    league: structuredClone(DEFAULT_LEAGUE),
    periods: structuredClone(DEFAULT_PERIODS),
    custom: { start: DEFAULT_PERIODS[0]!.start, end: DEFAULT_PERIODS[DEFAULT_PERIODS.length - 1]!.end },
    selection: 'all',
    roster: [],
    customPlayers: [],
    manual: {},
    scenario: EMPTY_SCENARIO,
  };
}

export type Action =
  | { type: 'select'; selection: Selection }
  | { type: 'setCustom'; start: ISODate; end: ISODate }
  | { type: 'setPeriods'; periods: Period[] }
  | { type: 'setLeague'; league: LeagueConfig }
  | { type: 'addPlayers'; ids: string[] }
  | { type: 'removePlayer'; id: string }
  | { type: 'updateEntry'; id: string; patch: Partial<Omit<RosterEntry, 'playerId'>> }
  | { type: 'replacePlayer'; from: string; to: string }
  | { type: 'addCustomPlayer'; player: Player }
  | { type: 'clearRoster' }
  | { type: 'setManual'; date: ISODate; override: DayOverride | null }
  | { type: 'clearManual'; dates?: ISODate[] }
  | { type: 'scenario'; scenario: Scenario }
  | { type: 'scenarioApply' };

/** Rewrite one player id in every date's choices (null removes it). Dates left without choices are dropped. */
function mapPlayerInManual(manual: AppState['manual'], from: string, to: string | null): AppState['manual'] {
  const out: AppState['manual'] = {};
  const fix = (ids: string[]) => [...new Set(ids.flatMap((id) => (id !== from ? [id] : to ? [to] : [])))];
  for (const [date, o] of Object.entries(manual)) {
    const next = { start: fix(o.start), sit: fix(o.sit) };
    if (!isEmptyOverride(next)) out[date] = next;
  }
  return out;
}
const withoutPlayerInManual = (manual: AppState['manual'], id: string) => mapPlayerInManual(manual, id, null);

export function proposedRoster(state: Pick<AppState, 'roster' | 'scenario'>): RosterEntry[] {
  const drops = new Set(state.scenario.drops);
  const kept = state.roster.filter((e) => !drops.has(e.playerId));
  const have = new Set(kept.map((e) => e.playerId));
  return [...kept, ...state.scenario.adds.filter((id) => !have.has(id)).map((id) => ({ playerId: id, onIr: false }))];
}

export function hasScenario(s: Scenario): boolean {
  return s.drops.length > 0 || s.adds.length > 0;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'select':
      return { ...state, selection: action.selection };
    case 'setCustom':
      return { ...state, custom: { start: action.start, end: action.end }, selection: 'custom' };
    case 'setPeriods': {
      const ids = new Set(action.periods.map((p) => p.id));
      const selection = state.selection === 'all' || state.selection === 'custom' || ids.has(state.selection) ? state.selection : 'all';
      return { ...state, periods: action.periods, selection };
    }
    case 'setLeague':
      // Roster and lineups are kept; conflicts are reported for the user to resolve.
      return { ...state, league: action.league };
    case 'addPlayers': {
      const have = new Set(state.roster.map((e) => e.playerId));
      const added = action.ids.filter((id) => !have.has(id) && (have.add(id), true));
      return { ...state, roster: [...state.roster, ...added.map((playerId) => ({ playerId, onIr: false }))] };
    }
    case 'removePlayer':
      return {
        ...state,
        roster: state.roster.filter((e) => e.playerId !== action.id),
        manual: withoutPlayerInManual(state.manual, action.id),
        scenario: { ...state.scenario, drops: state.scenario.drops.filter((d) => d !== action.id) },
      };
    case 'updateEntry': {
      // Daily choices are kept when a player moves to IR: they're reported as not applying
      // on those dates and take effect again if the player comes off IR.
      const roster = state.roster.map((e) => {
        if (e.playerId !== action.id) return e;
        const next = { ...e, ...action.patch };
        if (!next.preferred) delete next.preferred;
        return next;
      });
      return { ...state, roster };
    }
    case 'replacePlayer': {
      if (state.roster.some((e) => e.playerId === action.to)) return reducer(state, { type: 'removePlayer', id: action.from });
      return {
        ...state,
        roster: state.roster.map((e) => (e.playerId === action.from ? { ...e, playerId: action.to } : e)),
        manual: mapPlayerInManual(state.manual, action.from, action.to),
      };
    }
    case 'addCustomPlayer':
      return { ...state, customPlayers: [...state.customPlayers.filter((p) => p.id !== action.player.id), action.player] };
    case 'clearRoster':
      // removePlayer for everyone: manual lineups and trade drops only reference roster
      // players, so they go too. Settings, rounds, custom players and trade adds are kept.
      return { ...state, roster: [], manual: {}, scenario: { ...state.scenario, drops: [] } };
    case 'setManual': {
      const manual = { ...state.manual };
      if (action.override && !isEmptyOverride(action.override)) manual[action.date] = action.override;
      else delete manual[action.date];
      return { ...state, manual };
    }
    case 'clearManual': {
      if (!action.dates) return { ...state, manual: {} };
      const manual = { ...state.manual };
      for (const d of action.dates) delete manual[d];
      return { ...state, manual };
    }
    case 'scenario':
      return { ...state, scenario: action.scenario };
    case 'scenarioApply': {
      let manual = state.manual;
      for (const id of state.scenario.drops) manual = withoutPlayerInManual(manual, id);
      return { ...state, roster: proposedRoster(state), manual, scenario: EMPTY_SCENARIO };
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence: tolerant load. Each field is validated independently, so one
// malformed piece falls back to its default without discarding the rest.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPositions = (v: unknown): v is Position[] => Array.isArray(v) && v.every((p) => POSITIONS.includes(p as Position));

function loadLeague(v: unknown): LeagueConfig | undefined {
  if (!isObj(v) || !Array.isArray(v.slots)) return undefined;
  const league: LeagueConfig = {
    rosterSize: Number(v.rosterSize),
    irSlots: Number(v.irSlots),
    slots: v.slots.filter(isObj).map((s) => ({
      id: String(s.id),
      label: String(s.label ?? s.id),
      count: Number(s.count),
      accepts: isPositions(s.accepts) ? s.accepts : [],
    })),
  };
  return validateLeague(league).length === 0 ? league : undefined;
}

function loadPeriods(v: unknown): Period[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const periods = v.filter(isObj).map((p) => ({ id: String(p.id), name: String(p.name), start: p.start as string, end: p.end as string }));
  return periods.every((p) => isValidISODate(p.start) && isValidISODate(p.end) && p.start <= p.end) ? periods : undefined;
}

function loadRoster(v: unknown): RosterEntry[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  const out: RosterEntry[] = [];
  for (const e of v) {
    if (!isObj(e) || typeof e.playerId !== 'string' || seen.has(e.playerId)) continue;
    seen.add(e.playerId);
    out.push({
      playerId: e.playerId,
      onIr: e.onIr === true,
      ...(isPositions(e.positionsOverride) && e.positionsOverride.length ? { positionsOverride: e.positionsOverride } : {}),
      ...(e.preferred === true ? { preferred: true } : {}),
    });
  }
  return out;
}

function loadCustomPlayers(v: unknown): Player[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObj)
    .filter((p) => typeof p.id === 'string' && typeof p.name === 'string' && typeof p.team === 'string' && isPositions(p.positions))
    .map((p) => ({ id: p.id as string, name: p.name as string, team: p.team as string, positions: p.positions as Position[], eligibilitySource: 'user' as const }));
}

/**
 * Daily choices. Older saves stored a full lineup per date (seat key → player);
 * those players become the date's starts and the rest is filled automatically.
 */
function loadManual(v: unknown): AppState['manual'] {
  if (!isObj(v)) return {};
  const out: AppState['manual'] = {};
  const ids = (x: unknown) => [...new Set(Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])];
  for (const [date, o] of Object.entries(v)) {
    if (!isValidISODate(date) || !isObj(o)) continue;
    const next = Array.isArray(o.start) || Array.isArray(o.sit) ? { start: ids(o.start), sit: ids(o.sit) } : { start: ids(Object.values(o)), sit: [] };
    if (!isEmptyOverride(next)) out[date] = next;
  }
  return out;
}

function loadScenario(v: unknown): Scenario {
  if (!isObj(v)) return EMPTY_SCENARIO;
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  return { drops: strs(v.drops), adds: strs(v.adds) };
}

export function deserialize(raw: string | null): { state: AppState; notice?: string } {
  const base = initialState();
  if (!raw) return { state: base };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { state: base, notice: 'Saved data was unreadable and has been reset.' };
  }
  if (!isObj(data)) return { state: base, notice: 'Saved data was unreadable and has been reset.' };
  const problems: string[] = [];
  const league = loadLeague(data.league);
  if (data.league !== undefined && !league) problems.push('league settings');
  const periods = loadPeriods(data.periods);
  if (data.periods !== undefined && !periods) problems.push('playoff dates');
  const roster = loadRoster(data.roster);
  if (data.roster !== undefined && !roster) problems.push('roster');
  const custom =
    isObj(data.custom) && isValidISODate(data.custom.start) && isValidISODate(data.custom.end) && data.custom.start <= data.custom.end
      ? { start: data.custom.start, end: data.custom.end }
      : base.custom;
  const state: AppState = {
    ...base,
    league: league ?? base.league,
    periods: periods ?? base.periods,
    custom,
    selection: typeof data.selection === 'string' ? data.selection : base.selection,
    roster: roster ?? [],
    customPlayers: loadCustomPlayers(data.customPlayers),
    manual: loadManual(data.manual),
    scenario: loadScenario(data.scenario),
  };
  if (state.selection !== 'all' && state.selection !== 'custom' && !state.periods.some((p) => p.id === state.selection)) state.selection = 'all';
  return { state, ...(problems.length ? { notice: `Some saved ${problems.join(' and ')} couldn't be restored and were reset to defaults.` } : {}) };
}

export function serialize(state: AppState): string {
  return JSON.stringify(state);
}

export function loadFromStorage(): { state: AppState; notice?: string } {
  try {
    return deserialize(globalThis.localStorage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return { state: initialState(), notice: 'Browser storage is unavailable; changes won’t be saved.' };
  }
}

export function saveToStorage(state: AppState): boolean {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, serialize(state));
    return true;
  } catch {
    return false;
  }
}
