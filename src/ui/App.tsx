import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { buildPlayerLookup, isStale, loadDataset, type DataStatus } from '../data/load.ts';
import { dayCount, eachDate, formatRange, formatShort, isValidISODate } from '../domain/dates.ts';
import { optimizeDates, summarize, type DayResult, type LineupPlayer } from '../domain/optimizer.ts';
import { toLineupPlayers } from '../domain/roster.ts';
import type { ISODate, Player } from '../domain/types.ts';
import { loadFromStorage, reducer, saveToStorage } from '../state/appState.ts';
import { Ctx, useApp, type AppCtx, type Window } from './context.ts';
import { LineupView } from './Lineup.tsx';
import { RankingsView } from './Rankings.tsx';
import { RosterView } from './Roster.tsx';
import { SettingsModal } from './Settings.tsx';
import { TradesView } from './Trades.tsx';

const TABS = [
  { id: 'rankings', label: 'Team schedules' },
  { id: 'roster', label: 'Roster' },
  { id: 'lineup', label: 'Lineup' },
  { id: 'trades', label: 'Trade lab' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function tabFromHash(): TabId {
  const h = globalThis.location?.hash.replace('#', '');
  return (TABS.find((t) => t.id === h)?.id ?? 'rankings') as TabId;
}

export function App() {
  const [{ state: initial, notice }] = useState(loadFromStorage);
  const [state, dispatch] = useReducer(reducer, initial);
  const [status, setStatus] = useState<DataStatus>({ state: 'loading' });
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(notice ?? null);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    loadDataset()
      .then((data) => setStatus({ state: 'ready', data, stale: isStale(data) }))
      .catch((err: Error) => setStatus({ state: 'error', message: err.message }));
  }, []);

  useEffect(() => {
    setSaveFailed(!saveToStorage(state));
  }, [state]);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3500);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const toast = useCallback((m: string) => setToastMsg(m), []);
  const go = (id: TabId) => {
    history.replaceState(null, '', `#${id}`);
    setTab(id);
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-row">
            <div className="brand">
              Playoff <span>Schedule</span> Optimizer
            </div>
            <button className="settings-btn" onClick={() => setSettingsOpen(true)} aria-label="League settings" title="Review and adjust your league settings">
              <span aria-hidden="true">⚙︎</span> League settings
            </button>
          </div>
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}>
                {t.label}
                {t.id === 'roster' && state.roster.length > 0 && <span className="count">{state.roster.length}</span>}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main>
        {saveFailed && <div className="notice" style={{ marginBottom: 12 }}>Changes can’t be saved in this browser (storage is blocked or full).</div>}
        {status.state === 'loading' && <div className="empty">Loading NHL schedule…</div>}
        {status.state === 'error' && (
          <div className="notice error">
            <b>Schedule data couldn’t be loaded.</b> {status.message}
          </div>
        )}
        {status.state === 'ready' && (
          <Ready state={state} dispatch={dispatch} data={status.data} toast={toast}>
            {tab === 'rankings' && <RankingsView />}
            {tab === 'roster' && <RosterView onGoLineup={() => go('lineup')} />}
            {tab === 'lineup' && <LineupView onGoRoster={() => go('roster')} />}
            {tab === 'trades' && <TradesView onGoRoster={() => go('roster')} />}
            {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
          </Ready>
        )}
      </main>
      <DataFooter status={status} />
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </>
  );
}

/** Subtle data-freshness note at the foot of the page (errors are shown in the main area). */
function DataFooter({ status }: { status: DataStatus }) {
  if (status.state !== 'ready') return null;
  const d = status.data;
  const when = formatShort(d.scheduleFetchedAt.slice(0, 10));
  const title = [
    `NHL ${d.season.slice(0, 4)}–${d.season.slice(6)} regular season: ${d.schedule.games.length} games, ${d.teams.length} teams.`,
    `Schedule and rosters from the NHL, updated ${d.scheduleFetchedAt.replace('T', ' ').slice(0, 16)} UTC.`,
    `Eligibility: ${d.eligibilityDetail}.`,
    ...d.warnings.slice(0, 3),
  ].join('\n');
  return (
    <footer className={`data-status${status.stale ? ' stale' : ''}`} title={title}>
      {status.stale ? `NHL data from ${when}, may be outdated` : `NHL data updated ${when}`}
    </footer>
  );
}

function Ready(props: { state: AppCtx['state']; dispatch: AppCtx['dispatch']; data: AppCtx['data']; toast: AppCtx['toast']; children: React.ReactNode }) {
  const { state, dispatch, data, toast } = props;

  const lookup = useMemo(() => buildPlayerLookup(data.players, state.customPlayers), [data.players, state.customPlayers]);

  // Saved ids that now resolve under a different id (e.g. espn-123 → nhl-456) are migrated once.
  useEffect(() => {
    for (const e of state.roster) {
      const p = lookup.resolve(e.playerId);
      if (p && p.id !== e.playerId) dispatch({ type: 'replacePlayer', from: e.playerId, to: p.id });
    }
  }, [lookup, state.roster, dispatch]);

  const teams = useMemo(() => new Map(data.teams.map((t) => [t.id, t])), [data.teams]);

  const windows = useMemo<Window[]>(() => {
    const rounds = state.periods.map((p) => ({ ...p, dates: eachDate(p.start, p.end) }));
    const all = [...new Set(rounds.flatMap((r) => r.dates))].sort();
    const out: Window[] = [...rounds];
    if (all.length) out.push({ id: 'all', name: 'Full playoffs', start: all[0]!, end: all[all.length - 1]!, dates: all });
    out.push({ id: 'custom', name: 'Custom', start: state.custom.start, end: state.custom.end, dates: eachDate(state.custom.start, state.custom.end) });
    return out;
  }, [state.periods, state.custom]);

  const selected = windows.find((w) => w.id === state.selection) ?? windows[windows.length - 2] ?? windows[0]!;

  const playersMap = useMemo(() => {
    const m = new Map<string, Player>();
    for (const e of state.roster) {
      const p = lookup.resolve(e.playerId);
      if (p) m.set(e.playerId, p);
    }
    return m;
  }, [state.roster, lookup]);
  const lineupPlayers = useMemo(() => toLineupPlayers(state.roster, playersMap), [state.roster, playersMap]);

  const allDates = useMemo(() => [...new Set(windows.flatMap((w) => w.dates))].sort(), [windows]);
  const days = useMemo(
    () => optimizeDates(allDates, lineupPlayers, state.league, data.schedule, state.manual),
    [allDates, lineupPlayers, state.league, data.schedule, state.manual],
  );

  const summarizeWindow = useCallback(
    (w: Window, d: Map<ISODate, DayResult> = days, roster: LineupPlayer[] = lineupPlayers) =>
      summarize(w.dates.map((x) => d.get(x)!).filter(Boolean), roster, w.start, w.end),
    [days, lineupPlayers],
  );

  const ctx: AppCtx = { state, dispatch, data, resolve: lookup.resolve, teams, windows, selected, lineupPlayers, days, summarizeWindow, toast };
  return (
    <Ctx.Provider value={ctx}>
      <PeriodBar />
      {props.children}
    </Ctx.Provider>
  );
}

function PeriodBar() {
  const { state, dispatch, windows, selected, data } = useApp();
  const [draft, setDraft] = useState(state.custom);
  useEffect(() => setDraft(state.custom), [state.custom]);
  const outOfSeason =
    data.schedule.firstDate && data.schedule.lastDate && (selected.start < data.schedule.firstDate || selected.end > data.schedule.lastDate);
  const commit = (next: { start: string; end: string }) => {
    setDraft(next);
    if (isValidISODate(next.start) && isValidISODate(next.end) && next.start <= next.end) dispatch({ type: 'setCustom', ...next });
  };
  return (
    <div className="periodbar">
      <div className="segmented" role="group" aria-label="Date range">
        {windows.map((w) => (
          <button key={w.id} aria-pressed={selected.id === w.id} onClick={() => dispatch({ type: 'select', selection: w.id })}>
            {w.name}
          </button>
        ))}
      </div>
      {selected.id === 'custom' ? (
        <span className="date-inputs">
          <input type="date" aria-label="Start date" value={draft.start} onChange={(e) => commit({ ...draft, start: e.target.value })} />
          –
          <input type="date" aria-label="End date" value={draft.end} onChange={(e) => commit({ ...draft, end: e.target.value })} />
          {draft.start > draft.end && <span className="badge bad">End is before start</span>}
        </span>
      ) : null}
      <span className="range-label">
        {formatRange(selected.start, selected.end)}{' '}
        <span className="muted">
          · {selected.dates.length === dayCount(selected.start, selected.end) ? `${selected.dates.length} days` : `${selected.dates.length} days in rounds`}
        </span>
      </span>
      {outOfSeason && <span className="badge warn">Partly outside the NHL regular season</span>}
    </div>
  );
}
