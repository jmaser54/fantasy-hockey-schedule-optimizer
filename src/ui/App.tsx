import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { trackTabView } from '../analytics.ts';
import { takeContactReturn } from '../contact.ts';
import { buildPlayerLookup, isStale, loadDataset, type DataStatus } from '../data/load.ts';
import { dayCount, eachDate, formatRange, formatShort, isValidISODate, easternToday, nextWeek } from '../domain/dates.ts';
import { optimizeDates, summarize, type DayResult, type LineupPlayer } from '../domain/optimizer.ts';
import { activeSlotCount } from '../domain/league.ts';
import { toLineupPlayers } from '../domain/roster.ts';
import type { ISODate, Player } from '../domain/types.ts';
import { loadFromStorage, reducer, saveToStorage } from '../state/appState.ts';
import { Ctx, useApp, type AppCtx, type Window } from './context.ts';
import { AboutView } from './About.tsx';
import { ContactForm } from './Contact.tsx';
import { LineupView } from './Lineup.tsx';
import { RankingsView } from './Rankings.tsx';
import { RosterView } from './Roster.tsx';
import { SettingsModal } from './Settings.tsx';
import { TradesView } from './Trades.tsx';

const TABS = [
  { id: 'rankings', label: 'Team Schedules', short: 'Schedules' },
  { id: 'roster', label: 'Roster' },
  { id: 'lineup', label: 'Lineup' },
  { id: 'trades', label: 'Trade Lab' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const isAboutHash = () => globalThis.location?.hash === '#about';

function tabFromHash(): TabId {
  const h = globalThis.location?.hash.replace('#', '');
  return (TABS.find((t) => t.id === h)?.id ?? 'rankings') as TabId;
}

export function App() {
  const [{ state: initial, notice }] = useState(loadFromStorage);
  const [state, dispatch] = useReducer(reducer, initial);
  const [status, setStatus] = useState<DataStatus>({ state: 'loading' });
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [about, setAbout] = useState(isAboutHash);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(() => (takeContactReturn() ? 'Message sent. Thanks for getting in touch!' : (notice ?? null)));
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    loadDataset()
      .then((data) => setStatus({ state: 'ready', data, stale: isStale(data) }))
      .catch((err: Error) => setStatus({ state: 'error', message: err.message }));
  }, []);

  useEffect(() => {
    setSaveFailed(!saveToStorage(state));
  }, [state]);

  // GA4: the Google tag counts the initial load; count each later tab change once.
  const trackedTab = useRef(tab);
  useEffect(() => {
    if (tab === trackedTab.current) return;
    trackedTab.current = tab;
    trackTabView(TABS.find((t) => t.id === tab)!.label);
  }, [tab]);

  useEffect(() => {
    // #about opens the About page and keeps the current tab to return to.
    const onHash = () => {
      if (isAboutHash()) return setAbout(true);
      setAbout(false);
      setTab(tabFromHash());
    };
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
    setAbout(false);
  };
  useEffect(() => window.scrollTo(0, 0), [about]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            Playoff <span>Planner</span>
          </div>
          <p className="tagline">Plan your next week — and your playoff run. Add your roster to see which pickups are worth it.</p>
        </div>
      </header>
      <div className="tabbar">
        <div className="topbar-inner tabbar-row">
          <button className="settings-btn" onClick={() => setSettingsOpen(true)} title="Review and adjust your league settings">
            <span aria-hidden="true">⚙︎</span> League Settings
          </button>
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" className="tab" aria-selected={!about && tab === t.id} aria-label={'short' in t ? t.label : undefined} onClick={() => go(t.id)}>
                {'short' in t ? (
                  <>
                    <span className="label-full">{t.label}</span>
                    <span className="label-short" aria-hidden="true">
                      {t.short}
                    </span>
                  </>
                ) : (
                  t.label
                )}
                {t.id === 'roster' && state.roster.length > 0 && <span className="count">{state.roster.length}</span>}
              </button>
            ))}
          </nav>
        </div>
      </div>
      <main>
        {saveFailed && <div className="notice" style={{ marginBottom: 12 }}>Changes can’t be saved in this browser (storage is blocked or full).</div>}
        {about && status.state !== 'ready' && <AboutView />}
        {!about && status.state === 'loading' && <div className="empty">Loading NHL schedule…</div>}
        {!about && status.state === 'error' && (
          <div className="notice error">
            <b>Schedule data couldn’t be loaded.</b> {status.message}
          </div>
        )}
        {status.state === 'ready' && (
          <Ready
            state={state}
            dispatch={dispatch}
            data={status.data}
            toast={toast}
            periodBar={!about}
            showModes={tab !== 'roster'}
            onOpenSettings={() => setSettingsOpen(true)}
            overlay={settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
          >
            {about && <AboutView />}
            {!about && tab === 'rankings' && <RankingsView onGoRoster={() => go('roster')} />}
            {!about && tab === 'roster' && <RosterView onGoLineup={() => go('lineup')} />}
            {!about && tab === 'lineup' && <LineupView onGoRoster={() => go('roster')} />}
            {!about && tab === 'trades' && <TradesView onGoRoster={() => go('roster')} />}
          </Ready>
        )}
      </main>
      <DataFooter status={status} onContact={() => setContactOpen(true)} />
      {contactOpen && <ContactModal onClose={() => setContactOpen(false)} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </>
  );
}

/** The contact form, opened from the footer. */
function ContactModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel modal" role="dialog" aria-modal="true" aria-label="Contact">
        <ContactForm onBack={onClose} />
      </div>
    </div>
  );
}

/** Subtle footer: data-freshness note (errors are shown in the main area), Contact and the About link. */
function DataFooter({ status, onContact }: { status: DataStatus; onContact: () => void }) {
  const links = (
    <>
      <button type="button" className="foot-link foot-btn" onClick={onContact}>
        Contact
      </button>
      <a className="foot-link" href="#about">
        About
      </a>
    </>
  );
  if (status.state !== 'ready') return <footer className="data-status">{links}</footer>;
  const d = status.data;
  const when = formatShort(d.scheduleFetchedAt.slice(0, 10));
  const title = [
    `NHL ${d.season.slice(0, 4)}–${d.season.slice(6)} regular season: ${d.schedule.games.length} games, ${d.teams.length} teams.`,
    `Schedule and rosters from the NHL, updated ${d.scheduleFetchedAt.replace('T', ' ').slice(0, 16)} UTC.`,
    `Eligibility: ${d.eligibilityDetail}.`,
    ...d.warnings.slice(0, 3),
  ].join('\n');
  return (
    <footer className={`data-status${status.stale ? ' stale' : ''}`}>
      <span title={title}>{status.stale ? `NHL data from ${when}, may be outdated` : `NHL data updated ${when}`}</span>
      {links}
    </footer>
  );
}

/** Which kind of period the app analyzes. Not saved: every visit starts on Next Week. */
type Mode = 'week' | 'playoffs' | 'custom';
const MODES: { id: Mode; label: string }[] = [
  { id: 'week', label: 'Next Week' },
  { id: 'playoffs', label: 'Playoffs' },
  { id: 'custom', label: 'Custom' },
];

/** A user-defined period in Custom mode; dates stay empty until filled in. */
interface CustomPeriod {
  id: string;
  name: string;
  start: string;
  end: string;
}
const CUSTOM_TOTAL = 'custom-total';
const newCustomPeriod = (): CustomPeriod => ({ id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: '', start: '', end: '' });
const isComplete = (p: CustomPeriod) => isValidISODate(p.start) && isValidISODate(p.end) && p.start <= p.end;

interface PeriodControls {
  mode: Mode;
  setMode: (m: Mode) => void;
  customPeriods: CustomPeriod[];
  setCustomPeriods: (p: CustomPeriod[]) => void;
  customTotal: boolean;
  setCustomTotal: (on: boolean) => void;
}

function Ready(props: {
  state: AppCtx['state'];
  dispatch: AppCtx['dispatch'];
  data: AppCtx['data'];
  toast: AppCtx['toast'];
  periodBar: boolean;
  /** False on Roster: no period toggle there (its Games column always shows next week). */
  showModes: boolean;
  onOpenSettings: () => void;
  overlay: React.ReactNode;
  children: React.ReactNode;
}) {
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

  const [mode, setMode] = useState<Mode>('week');
  const [customPeriods, setCustomPeriods] = useState<CustomPeriod[]>(() => [newCustomPeriod()]);
  const [customTotal, setCustomTotal] = useState(false);

  // Playoff rounds and "Full Playoffs", as before; Team Schedules also uses them for context.
  const playoffWindows = useMemo<Window[]>(() => {
    const rounds = state.periods.map((p) => ({ ...p, dates: eachDate(p.start, p.end) }));
    const all = [...new Set(rounds.flatMap((r) => r.dates))].sort();
    const out: Window[] = [...rounds];
    if (all.length) out.push({ id: 'all', name: 'Full Playoffs', start: all[0]!, end: all[all.length - 1]!, dates: all });
    return out;
  }, [state.periods]);

  const today = easternToday();
  const weekWindow = useMemo<Window>(() => {
    const { start, end } = nextWeek(today);
    return { id: 'week', name: 'Next Week', start, end, dates: eachDate(start, end) };
  }, [today]);

  const customWindows = useMemo<Window[]>(() => {
    const out: Window[] = customPeriods.flatMap((p, i) =>
      isComplete(p) ? [{ id: p.id, name: p.name.trim() || `Period ${i + 1}`, start: p.start, end: p.end, dates: eachDate(p.start, p.end) }] : [],
    );
    const all = [...new Set(out.flatMap((w) => w.dates))].sort();
    if (customTotal && all.length) out.push({ id: CUSTOM_TOTAL, name: 'Total', start: all[0]!, end: all[all.length - 1]!, dates: all });
    return out;
  }, [customPeriods, customTotal]);

  const windows = mode === 'week' ? [weekWindow] : mode === 'playoffs' ? playoffWindows : customWindows;
  // Playoffs default to the first round; Custom to its first period. Neither has a window until one exists.
  const selected: Window | undefined = windows.find((w) => w.id === state.selection) ?? windows[0];

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

  // An empty Custom mode has no window yet: the tabs wait for dates, but settings still work.
  const placeholder: Window = { id: 'none', name: 'Custom', start: weekWindow.start, end: weekWindow.end, dates: [] };
  const ctx: AppCtx = {
    state,
    dispatch,
    data,
    resolve: lookup.resolve,
    teams,
    windows,
    playoffWindows,
    weekWindow,
    selected: selected ?? placeholder,
    lineupPlayers,
    days,
    summarizeWindow,
    toast,
  };
  const controls: PeriodControls = { mode, setMode, customPeriods, setCustomPeriods, customTotal, setCustomTotal };
  return (
    <Ctx.Provider value={ctx}>
      {props.periodBar && props.showModes && <PeriodBar {...controls} hasWindow={!!selected} />}
      {props.periodBar && <SetupLine mode={mode} hasWindow={!!selected} onOpen={props.onOpenSettings} />}
      {props.periodBar && props.showModes && !selected ? <div className="empty">Enter a start and end date for your period above.</div> : props.children}
      {props.overlay}
    </Ctx.Provider>
  );
}

/** Quiet summary of the league setup; opens League Settings. */
function SetupLine({ mode, hasWindow, onOpen }: { mode: Mode; hasWindow: boolean; onOpen: () => void }) {
  const { state, selected } = useApp();
  const parts = [`${state.league.rosterSize} roster`, `${state.league.irSlots} IR`, `${activeSlotCount(state.league)} starters`];
  if (mode === 'playoffs' && hasWindow) parts.push(`${selected.name}: ${formatRange(selected.start, selected.end)}`);
  return (
    <button type="button" className="setup-line" onClick={onOpen} title="Open League Settings">
      {parts.join(' · ')}
    </button>
  );
}

function PeriodBar(props: PeriodControls & { hasWindow: boolean }) {
  const { mode, setMode } = props;
  const { dispatch, windows, selected, data } = useApp();
  const outOfSeason =
    props.hasWindow &&
    data.schedule.firstDate &&
    data.schedule.lastDate &&
    (selected.start < data.schedule.firstDate || selected.end > data.schedule.lastDate);
  const rangeLabel = (
    <span className="range-label">
      {formatRange(selected.start, selected.end)}{' '}
      <span className="muted">
        · {selected.dates.length === dayCount(selected.start, selected.end) ? `${selected.dates.length} days` : `${selected.dates.length} days in rounds`}
      </span>
    </span>
  );
  return (
    <div className="periodbar">
      <div className="period-modes">
        <div className="segmented mode-toggle" role="group" aria-label="Period">
          {MODES.map((m) => (
            <button key={m.id} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        {mode === 'week' && <span className="small muted">{formatRange(selected.start, selected.end)}</span>}
      </div>
      {mode !== 'week' && (
        <div className="period-controls">
          {windows.length > 0 && (
            <div className="segmented" role="group" aria-label="Date range">
              {windows.map((w) => (
                <button key={w.id} aria-pressed={selected.id === w.id} onClick={() => dispatch({ type: 'select', selection: w.id })}>
                  {w.name}
                </button>
              ))}
            </div>
          )}
          {props.hasWindow && rangeLabel}
          {outOfSeason && <span className="badge warn">Partly outside the NHL regular season</span>}
        </div>
      )}
      {mode === 'custom' && <CustomEditor {...props} />}
    </div>
  );
}

/** Custom mode's periods: any number, each with a name and any dates, plus an optional Total across them. */
function CustomEditor({ customPeriods, setCustomPeriods, customTotal, setCustomTotal }: PeriodControls) {
  const update = (i: number, patch: Partial<CustomPeriod>) => setCustomPeriods(customPeriods.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const anyComplete = customPeriods.some(isComplete);
  return (
    <div className="custom-periods">
      {customPeriods.map((p, i) => {
        const label = p.name.trim() || `Period ${i + 1}`;
        return (
          <div key={p.id} className="custom-row">
            <input aria-label={`Period ${i + 1} name`} placeholder={`Period ${i + 1}`} value={p.name} onChange={(e) => update(i, { name: e.target.value })} />
            <span className="date-inputs">
              <input type="date" aria-label={`${label} start date`} value={p.start} onChange={(e) => update(i, { start: e.target.value })} />
              –
              <input type="date" aria-label={`${label} end date`} value={p.end} onChange={(e) => update(i, { end: e.target.value })} />
            </span>
            {p.start && p.end && p.start > p.end && <span className="badge bad">End is before start</span>}
            <button className="icon-btn" aria-label={`Delete ${label}`} onClick={() => setCustomPeriods(customPeriods.filter((_, k) => k !== i))}>
              ✕
            </button>
          </div>
        );
      })}
      <div className="row-actions">
        <button className="btn small" onClick={() => setCustomPeriods([...customPeriods, newCustomPeriod()])}>
          Add period
        </button>
        {customTotal ? (
          <button className="btn small ghost" onClick={() => setCustomTotal(false)}>
            Remove Total
          </button>
        ) : (
          <button className="btn small ghost" disabled={!anyComplete} title="A Total period spanning all your periods" onClick={() => setCustomTotal(true)}>
            Add Total
          </button>
        )}
      </div>
    </div>
  );
}
