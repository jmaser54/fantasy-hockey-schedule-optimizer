import { isLeagueComplete } from '../domain/league.ts';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addDays, easternToday, formatShort, weekday } from '../domain/dates.ts';
import {
  addOptions,
  fillCandidates,
  benchStatus,
  gameKind,
  moveOptions,
  overrideFor,
  placeOptions,
  planIrChange,
  replaceOptions,
  summarizeDays,
  type DayChange,
  type DaySummary,
  type IrPlan,
  type Lineup,
} from '../domain/lineupActions.ts';
import { expandSeats, type DayResult, type LineupPlayer } from '../domain/optimizer.ts';
import { opponent } from '../domain/schedule.ts';
import type { Game, ISODate } from '../domain/types.ts';
import { lineupGroupTotals } from '../domain/capacity.ts';
import { useApp, type Window } from './context.ts';
import { PosBadges, PreferredToggle } from './common.tsx';
import { ScheduleGrid } from './Schedule.tsx';

/**
 * Which view of the Lineup tab is shown: "Team Schedule" (schedule) or "Set Lineup" (lineup). Since
 * 2026-11-26 entering the tab always opens Team Schedule; the choice then holds while the user stays in
 * the tab (switching days, periods or views), and is no longer remembered in sessionStorage.
 */
type PlanView = 'lineup' | 'schedule';

/**
 * Lineup page (rebuild, 2026-11-23). Two connected levels:
 * 1. Period overview: the selected period's total and every date's games in a calendar, which is
 *    also the day selector.
 * 2. Daily lineup for the selected date: starters by position, open spots (only when real), the bench
 *    (always visible) and IR. Tapping a player opens their sheet: replacements both ways, position
 *    changes, ★ priority and IR.
 * Changes are saved for that date only, as exact lineups; Reset Day / Reset <period> to Optimal and the
 * IR re-optimization work as before (`lineupActions.ts`).
 */

/** The first date in the period that is today or later (US Eastern), else the first date. */
function firstUpcoming(dates: readonly ISODate[]): ISODate | undefined {
  const today = easternToday();
  return dates.find((d) => d >= today) ?? dates[0];
}

function useSeats() {
  const { state } = useApp();
  return useMemo(() => expandSeats(state.league.slots), [state.league.slots]);
}

export function LineupView({ onGoRoster }: { onGoRoster: () => void }) {
  const { state, selected, windows, lineupPlayers, openSettings } = useApp();
  const [view, setView] = useState<PlanView>('schedule');
  const [date, setDate] = useState<ISODate | undefined>(() => firstUpcoming(selected.dates));
  // The open player sheet: a player on a date (the Lineup view's selected day, or a Schedule cell's date).
  const [sheetAt, setSheetAt] = useState<{ playerId: string; date: ISODate } | null>(null);
  const setSheet = (id: string | null) => setSheetAt(id && date ? { playerId: id, date } : null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!date || !selected.dates.includes(date)) setDate(firstUpcoming(selected.dates));
  }, [selected, date]);
  useEffect(() => {
    if (sheetAt && (!lineupPlayers.some((p) => p.id === sheetAt.playerId) || !selected.dates.includes(sheetAt.date))) setSheetAt(null);
  }, [sheetAt, lineupPlayers, selected]);
  const openPlayer = (id: string, el?: HTMLElement | null) => {
    if (el) opener.current = el;
    setSheet(id);
  };
  // Filling an empty lineup slot (2026-11-24): any eligible bench player, with or without a game.
  const [fillAt, setFillAt] = useState<{ date: ISODate; seatKey: string } | null>(null);
  const openFill = (seatKey: string, el: HTMLElement) => {
    opener.current = el;
    if (date) setFillAt({ date, seatKey });
  };
  const closeFill = () => {
    setFillAt(null);
    const el = opener.current;
    requestAnimationFrame(() => el?.isConnected && el.focus({ preventScroll: true }));
  };
  // Closing returns focus to the row that opened the sheet; the page doesn't scroll.
  const close = () => {
    setSheet(null);
    const el = opener.current;
    requestAnimationFrame(() => el?.isConnected && el.focus({ preventScroll: true }));
  };

  if (state.roster.length === 0) {
    return (
      <div className="panel empty">
        <strong>Add your roster to see how many games fit your lineup</strong>
        <button className="btn primary" onClick={onGoRoster} style={{ marginTop: 8 }}>
          Add Players
        </button>
      </div>
    );
  }
  // Incomplete league (new users, 2026-11-26): no lineup is calculated from blank slot counts.
  if (!isLeagueComplete(state.league)) {
    return (
      <div className="panel empty">
        <strong>Complete your league settings to see how many games fit your lineup</strong>
        <button className="btn primary" onClick={openSettings} style={{ marginTop: 8 }}>
          League Settings
        </button>
      </div>
    );
  }

  const switcher = (
    <div className="segmented plan-views" role="group" aria-label="View: Team Schedule or Set Lineup">
      {(['schedule', 'lineup'] as const).map((v) => (
        <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
          {v === 'schedule' ? 'Team Schedule' : 'Set Lineup'}
        </button>
      ))}
    </div>
  );

  // Shown once above the switcher (2026-11-26): the period cards and the period summary.
  const shared = (
    <>
      {windows.length > 1 && <SummaryCards />}
      <PeriodOverview window={selected} date={date} onDate={setDate} part="summary" />
    </>
  );

  if (view === 'schedule') {
    return (
      <div className="stack sg-view">
        {shared}
        {switcher}
        <section className="panel sg-panel" aria-label={`Schedule for ${selected.name}`}>
          <div className="panel-body sg-panel-body">
            <ScheduleGrid
              window={selected}
              active={sheetAt ?? undefined}
              selectedDate={date}
              onDate={(d) => {
                // A date header opens that day in Set Lineup (the selected day carries both ways).
                setDate(d);
                setView('lineup');
              }}
              onCell={(playerId, d, el) => {
                opener.current = el;
                setSheetAt({ playerId, date: d });
              }}
            />
          </div>
        </section>
        {sheetAt && (
          <PlayerSheet
            key={`${sheetAt.playerId}|${sheetAt.date}`}
            playerId={sheetAt.playerId}
            date={sheetAt.date}
            onClose={close}
            onOpenInLineup={() => {
              setDate(sheetAt.date);
              setSheetAt(null);
              setView('lineup');
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      {shared}
      {switcher}
      <div className="lu">
        <PeriodOverview window={selected} date={date} onDate={setDate} part="calendar" />
        {date && <DayLineup date={date} onPlayer={openPlayer} onFill={openFill} />}
      </div>
      {sheetAt && <PlayerSheet key={`${sheetAt.playerId}|${sheetAt.date}`} playerId={sheetAt.playerId} date={sheetAt.date} onClose={close} />}
      {fillAt && <FillSheet key={`${fillAt.date}|${fillAt.seatKey}`} date={fillAt.date} seatKey={fillAt.seatKey} onClose={closeFill} />}
    </div>
  );
}

/** The period choices with their totals (only when the mode has more than one, e.g. playoff rounds). */
function SummaryCards() {
  const { windows, selected, dispatch, summarizeWindow, lineupPlayers } = useApp();
  const shown = windows.filter((w) => w.id !== 'custom' || selected.id === 'custom');
  return (
    <div className="cards">
      {shown.map((w) => {
        const s = summarizeWindow(w);
        const t = lineupGroupTotals(s.players, lineupPlayers);
        const pct = t.all.scheduled ? Math.round((t.all.inLineup / t.all.scheduled) * 100) : 0;
        return (
          <button key={w.id} className="card" aria-pressed={w.id === selected.id} onClick={() => dispatch({ type: 'select', selection: w.id })}>
            <div className="label">{w.name}</div>
            <div className="big">
              {t.all.inLineup} <small>of {t.all.scheduled}</small>
            </div>
            <div className="sub">games fit your lineup</div>
            <div className="meter">
              <div style={{ width: `${pct}%` }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Period overview

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
/** Monday of the date's week. */
const mondayOf = (d: ISODate) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));

/**
 * The period summary (headline, facts, your-changes bar; shown once above the Team Schedule / Set Lineup
 * switcher since 2026-11-26) or, with part="calendar", the day calendar (Set Lineup's day picker).
 */
function PeriodOverview({ window: w, date, onDate, part }: { window: Window; date?: ISODate; onDate: (d: ISODate) => void; part: 'summary' | 'calendar' }) {
  const { days, summarizeWindow, lineupPlayers, dispatch } = useApp();
  const seats = useSeats();
  const summary = summarizeWindow(w);
  const t = lineupGroupTotals(summary.players, lineupPlayers);
  const perDay = useMemo(() => summarizeDays(w.dates.map((d) => days.get(d)!).filter(Boolean), lineupPlayers, seats), [w.dates, days, lineupPlayers, seats]);
  const byDate = new Map(perDay.map((d) => [d.date, d]));
  const manualDates = perDay.filter((d) => d.manual).map((d) => d.date);
  const openDays = perDay.filter((d) => d.opportunities.length > 0);
  const missed = summary.scheduled - summary.usable;
  // Calendar rows Monday–Sunday covering the period; dates outside it stay blank (e.g. gaps between rounds).
  const weeks: (ISODate | null)[][] = [];
  if (w.dates.length) {
    const inWindow = new Set(w.dates);
    for (let mon = mondayOf(w.dates[0]!); mon <= w.dates[w.dates.length - 1]!; mon = addDays(mon, 7)) {
      weeks.push(Array.from({ length: 7 }, (_, i) => addDays(mon, i)).map((d) => (inWindow.has(d) ? d : null)));
    }
  }
  if (part === 'calendar')
    return (
      <section className="panel lu-overview" aria-label={`Days in ${w.name}`}>
        <div className="panel-body lu-overview-body">
          <div className="lu-cal" role="group" aria-label={`Days in ${w.name}`}>
            {WEEKDAYS.map((x, i) => (
              <div key={`h${i}`} className="lu-cal-head" aria-hidden="true">
                {x}
              </div>
            ))}
            {weeks.flat().map((d, i) => (d ? <DayTile key={d} s={byDate.get(d)!} selected={d === date} onClick={() => onDate(d)} /> : <div key={`e${i}`} className="lu-day-blank" />))}
          </div>
        </div>
      </section>
    );
  return (
    <section className="panel lu-summary" aria-label="Period overview">
      <div className="panel-head">
        <h2>
          {w.name}: {summary.usable} of {summary.scheduled} scheduled games fit your lineup
        </h2>
      </div>
      <div className="panel-body lu-overview-body">
        <p className="lu-facts small">
          Skaters {t.skaters.inLineup}/{t.skaters.scheduled} · Goalies {t.goalies.inLineup}/{t.goalies.scheduled}
          {missed > 0 && <> · {missed} not in your lineup</>}
          {openDays.length > 0 && (
            <>
              {' '}
              · <span className="lu-open-text">open spots on {openDays.length} day{openDays.length === 1 ? '' : 's'}</span>
            </>
          )}
        </p>
        {manualDates.length > 0 && (
          <div className="lu-manual-bar">
            <span className="badge manual" title="Days where you changed the lineup. Other days are fully optimized.">
              Your changes on {manualDates.length} day{manualDates.length === 1 ? '' : 's'}
              {summary.usable < summary.optimalUsable ? ` · optimal ${summary.optimalUsable}` : ''}
            </span>
            {perDay.some((d) => d.hasIssues) && (
              <button className="badge warn" style={{ border: 0, cursor: 'pointer' }} onClick={() => onDate(perDay.find((d) => d.hasIssues)!.date)}>
                {perDay.filter((d) => d.hasIssues).length} day{perDay.filter((d) => d.hasIssues).length === 1 ? ' has' : 's have'} changes that no longer apply
              </button>
            )}
            <button
              className="btn small"
              onClick={() => {
                if (confirm('Revert lineup changes?')) dispatch({ type: 'clearManual', dates: manualDates });
              }}
            >
              Reset {w.name} to Optimal
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function DayTile({ s, selected, onClick }: { s: DaySummary; selected: boolean; onClick: () => void }) {
  const pct = s.scheduled ? Math.round((s.usable / s.scheduled) * 100) : 0;
  const label = `${weekday(s.date)} ${formatShort(s.date)}: ${s.scheduled ? `${s.usable} of ${s.scheduled} games fit your lineup` : 'no games'}${s.opportunities.length ? `, ${s.opportunities.length} open spot${s.opportunities.length === 1 ? '' : 's'}` : s.noRoom.length ? `, no room for ${s.noRoom.length} game${s.noRoom.length === 1 ? '' : 's'}` : ''}${s.manual ? ', your changes' : ''}`;
  return (
    <button type="button" className={`lu-day ${s.hasIssues ? 'issue' : ''} ${s.attention ? `att-${s.attention}` : ''}`} aria-pressed={selected} aria-label={label} title={label} onClick={onClick}>
      <span className="lu-day-date">{Number(s.date.slice(8))}</span>
      <span className="lu-day-count">
        {s.scheduled ? (
          <>
            <b>{s.usable}</b>/{s.scheduled}
          </>
        ) : (
          '–'
        )}
      </span>
      <span className="lu-day-bar">
        <span style={{ width: `${pct}%` }} />
      </span>
      {/* Crimson dot + bar: an avoidable benching; pale yellow tile (no dot): games that don't fit (2026-11-26). */}
      {s.attention === 'avoidable' && <span className="lu-dot lu-day-dot" aria-hidden="true" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 2. Daily lineup

const matchupOf = (day: DayResult, id: string): { text: string; game?: Game } => {
  const st = day.players.find((x) => x.playerId === id);
  if (!st?.game) return { text: 'No game' };
  const o = opponent(st.game, st.team);
  return { text: `${o.home ? 'vs' : '@'} ${o.team}`, game: st.game };
};

/** Saves one date's new lineup (only that date changes), as before. True once saved; false (and a toast) if it failed. */
function useSaveDay() {
  const { state, dispatch, lineupPlayers, data, toast } = useApp();
  const seats = useSeats();
  return (date: ISODate, next: Lineup): boolean => {
    try {
      dispatch({ type: 'setManual', date, override: overrideFor(date, next, lineupPlayers, seats, data.schedule, state.manual[date]?.notes) });
    } catch {
      toast('That change couldn’t be saved.');
      return false;
    }
    toast('Lineup saved.');
    return true;
  };
}

function DayLineup({ date, onPlayer, onFill }: { date: ISODate; onPlayer: (id: string, el: HTMLElement) => void; onFill: (seatKey: string, el: HTMLElement) => void }) {
  const { days, lineupPlayers, dispatch, data, teams } = useApp();
  const seats = useSeats();
  const save = useSaveDay();
  const day = days.get(date);
  if (!day) return null;
  const byId = new Map(lineupPlayers.map((p) => [p.id, p]));
  const seated = new Set(day.seats.flatMap((x) => (x.playerId ? [x.playerId] : [])));
  const bench = lineupPlayers.filter((p) => !p.onIr && !seated.has(p.id));
  // Bench players with a game first, then those without.
  bench.sort((a, b) => Number(!matchupOf(day, a.id).game) - Number(!matchupOf(day, b.id).game));
  const ir = lineupPlayers.filter((p) => p.onIr);
  const players = new Map(lineupPlayers.map((p) => [p.id, p]));
  const open = day.manual
    ? bench.filter((p) => gameKind(day, p.id, players, seats) === 'opportunity').map((p) => ({ p, option: addOptions(day, p.id, lineupPlayers, seats).find((o) => o.kind === 'open') }))
    : [];
  const nhlGames = data.schedule.gamesOn(date);

  const row = (p: LineupPlayer, posLabel: string, kind: 'starter' | 'bench' | 'ir') => {
    const cls = { starter: 'lu-starter', bench: 'lu-benched', ir: 'lu-onir' }[kind];
    const m = matchupOf(day, p.id);
    // Benched players with a game (2026-11-26): crimson edge when they fit without giving up a game, "No room" otherwise.
    const status = kind === 'bench' ? benchStatus(day, p.id, players, seats) : undefined;
    return (
      <div key={`${kind}-${p.id}-${posLabel}`} className={`lu-row ${cls} ${kind === 'starter' && !m.game ? 'lu-idle' : ''} ${status === 'avoidable' ? 'lu-avoid' : status === 'no-room' ? 'lu-noroom-row' : ''}`}>
        <button
          type="button"
          className="lu-main"
          onClick={(e) => onPlayer(p.id, e.currentTarget)}
          aria-label={`${p.name}, ${posLabel}, ${m.text}${status === 'avoidable' ? ', fits your lineup' : status === 'no-room' ? ', no room' : ''}: details and replacements`}
        >
          <span className={`lu-pos ${cls}`}>{posLabel}</span>
          <span className="lu-name">
            {p.name}
            {kind !== 'starter' && <PosBadges positions={p.positions} />}
          </span>
          <span className={`lu-game ${m.game ? '' : 'muted'}`}>
            {status === 'no-room' && <span className="lu-noroom">No room · </span>}
            {m.text}
          </span>
        </button>
        <PreferredToggle id={p.id} name={p.name} preferred={!!p.preferred} />
      </div>
    );
  };

  return (
    <section className="panel lu-daily" aria-label={`Lineup for ${weekday(date)} ${formatShort(date)}`}>
      <div className="panel-head lu-daily-head">
        <h2>
          Lineup for {weekday(date)} {formatShort(date)}
          <span className="lu-day-count-text">
            {' '}
            · {day.usable} of {day.scheduled} games fit
          </span>
        </h2>
        {day.manual ? <span className="badge manual">Your Changes</span> : <span className="badge good">Optimized</span>}
      </div>
      <div className="panel-body lu-daily-body">
        {day.manualIssues.length > 0 && <div className="notice">Some of your changes for this day no longer apply and are being ignored: {day.manualIssues.join(' ')}</div>}
        {day.manual && (
          <div className="lu-manual-note">
            <p className="section-hint">This day keeps your saved lineup; starring or unstarring players won’t change it. Choose Reset Day to Optimal to follow current stars.</p>
            <button className="btn small" onClick={() => dispatch({ type: 'setManual', date, override: null })}>
              Reset Day to Optimal
            </button>
          </div>
        )}
        {open.length > 0 && (
          <div className="lu-open" aria-label="Open spots">
            <h3>Open spots</h3>
            {open.map(({ p, option }) => (
              <div key={p.id} className="lu-open-row">
                <span>
                  <b>{p.name}</b> {matchupOf(day, p.id).text}
                  {option ? <span className="small muted"> · fits at {option.seatLabel}</span> : null}
                </span>
                {option && (
                  <button className="btn small primary" onClick={() => save(date, option.next)} aria-label={`Add ${p.name} at ${option.seatLabel}`}>
                    Add
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="lu-list lu-starters" aria-label="Starting lineup">
          {day.seats.map(({ seat, playerId }) => {
            const p = playerId ? byId.get(playerId) : undefined;
            return p ? (
              row(p, seat.label, 'starter')
            ) : (
              // A genuinely empty slot: says whether the roster has anyone who could fill it.
              fillCandidates(day, seat.key, lineupPlayers, seats).length > 0 ? (
                <button key={seat.key} type="button" className="lu-row lu-starter lu-noone lu-fill" onClick={(e) => onFill(seat.key, e.currentTarget)} aria-label={`Empty ${seat.label} slot: choose a bench player`}>
                  <span className="lu-pos lu-starter">{seat.label}</span>
                  <span className="lu-empty">
                    Empty <span className="small">· tap to fill</span>
                  </span>
                </button>
              ) : (
                <div key={seat.key} className="lu-row lu-starter lu-noone">
                  <span className="lu-pos lu-starter">{seat.label}</span>
                  <span className="lu-empty">
                    Empty <span className="small">· no eligible player on your roster</span>
                  </span>
                </div>
              )
            );
          })}
        </div>
        <h3 className="lu-sub">Bench</h3>
        <div className="lu-list lu-bench" aria-label="Bench">
          {bench.length ? bench.map((p) => row(p, 'BN', 'bench')) : <div className="muted small">Everyone is in the lineup.</div>}
        </div>
        {ir.length > 0 && (
          <>
            <h3 className="lu-sub">IR</h3>
            <div className="lu-list lu-ir" aria-label="On IR">
              {ir.map((p) => row(p, 'IR', 'ir'))}
            </div>
          </>
        )}
        <details className="lu-nhl">
          <summary className="small">NHL games this day ({nhlGames.length})</summary>
          <div className="game-chips">
            {nhlGames.map((g) => (
              <span key={g.id} className="game-chip" title={`${teams.get(g.away)?.name} at ${teams.get(g.home)?.name}`}>
                {g.away} @ {g.home}
              </span>
            ))}
            {nhlGames.length === 0 && <span className="muted small">No NHL games.</span>}
          </div>
        </details>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Player sheet: a bottom sheet on phones, a side panel on desktop.

function Sheet({ label, title, onClose, children }: { label: string; title: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" onClick={onClose} />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={label} ref={ref} tabIndex={-1}>
        <div className="sheet-head">
          <div className="sheet-title">{title}</div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}

function ChangeList({ changes, emptyText }: { changes: DayChange[]; emptyText: string }) {
  const { lineupPlayers } = useApp();
  const name = (id: string) => lineupPlayers.find((p) => p.id === id)?.name ?? id;
  if (changes.length === 0) return <p className="small muted">{emptyText}</p>;
  return (
    <ul className="change-list">
      {changes.map((c) => (
        <li key={c.date}>
          <b>
            {weekday(c.date)} {formatShort(c.date)}:
          </b>{' '}
          {c.added.map((id) => (
            <span key={`+${id}`} className="gain-text">
              + {name(id)}{' '}
            </span>
          ))}
          {c.removed.map((id) => (
            <span key={`-${id}`} className="lose-text">
              − {name(id)}{' '}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

type Pending = { inId: string; outId: string; seatLabel: string; gain?: Game; lose?: Game; next: Lineup };
type IrStep = { kind: 'confirm' | 'done'; plan: IrPlan; toIr: boolean };

/**
 * The player sheet. From the Schedule view (`onOpenInLineup`) it is the compact version: the same
 * assignment, replacement and position options for that date, without the ★ and IR rows (★ is on the
 * grid row; IR belongs to the Lineup view), plus a way to open that day in the Lineup view.
 */
function PlayerSheet({ playerId, date, onClose, onOpenInLineup }: { playerId: string; date: ISODate; onClose: () => void; onOpenInLineup?: () => void }) {
  const { state, days, dispatch, lineupPlayers, selected, data, teams, toast } = useApp();
  const seats = useSeats();
  const save = useSaveDay();
  const [pending, setPending] = useState<Pending | null>(null);
  const [irStep, setIrStep] = useState<IrStep | null>(null);
  const day = days.get(date)!;
  const byId = new Map(lineupPlayers.map((x) => [x.id, x]));
  const p = byId.get(playerId);
  if (!p || !day) return null;
  const name = (id: string) => byId.get(id)?.name ?? id;
  const m = matchupOf(day, playerId);
  const seat = day.seats.find((x) => x.playerId === playerId)?.seat;
  const irCount = state.roster.filter((e) => e.onIr).length;
  const activeCount = state.roster.length - irCount;
  const irFull = irCount >= state.league.irSlots;
  const when = `${weekday(date)} ${formatShort(date)}`;
  const title = (
    <>
      <b>{p.name}</b> <PosBadges positions={p.positions} />
      <div className="small muted">
        {teams.get(p.team)?.name ?? p.team} · {when}: {m.text}
      </div>
    </>
  );
  let body: ReactNode;
  if (pending) {
    body = (
      <div className="stack">
        <p>
          Start <b>{name(pending.inId)}</b> at {pending.seatLabel} instead of <b>{name(pending.outId)}</b> on {when}?
        </p>
        <ul className="trade-list">
          <li className={pending.gain ? 'gain' : ''}>{pending.gain ? `Gain: ${name(pending.inId)} ${matchupOf(day, pending.inId).text}` : `${name(pending.inId)} has no game`}</li>
          <li className={pending.lose ? 'lose' : ''}>{pending.lose ? `Give up: ${name(pending.outId)} ${matchupOf(day, pending.outId).text}` : `${name(pending.outId)} has no game`}</li>
        </ul>
        <p className="small muted">Only this day changes.</p>
        <div className="sheet-actions">
          <button
            className="btn primary"
            onClick={() => {
              // Close the sheet once the change is saved (2026-11-26); it stays open if saving failed.
              if (save(date, pending.next)) onClose();
              else setPending(null);
            }}
          >
            Confirm
          </button>
          <button className="btn" onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  } else if (irStep?.kind === 'confirm') {
    const { plan, toIr } = irStep;
    body = (
      <div className="stack">
        {toIr ? (
          <p>
            <b>{p.name}</b> will leave your lineup on every day and use an IR slot. Days you haven’t changed are re-optimized; on days you changed, only {p.name}’s spot is refilled.
          </p>
        ) : (
          <p>
            <b>{p.name}</b> returns to your active roster. Days you haven’t changed are re-optimized to include them where they fit; days you changed keep your lineup.
            {activeCount + 1 > state.league.rosterSize && ` Your active roster will have ${activeCount + 1} players; your limit is ${state.league.rosterSize}.`}
          </p>
        )}
        <p className="small">
          {selected.name}: {plan.before} → {plan.after} games fit your lineup.
        </p>
        <ChangeList changes={plan.changes} emptyText={`No lineup changes in ${selected.name}.`} />
        <div className="sheet-actions">
          <button
            className="btn primary"
            onClick={() => {
              dispatch({ type: 'applyIrChange', id: playerId, onIr: toIr, manual: plan.manual });
              setIrStep({ kind: 'done', plan, toIr });
              toast(toIr ? `${p.name} moved to IR.` : `${p.name} moved off IR.`);
            }}
          >
            {toIr ? 'Move to IR' : 'Move off IR'}
          </button>
          <button className="btn" onClick={() => setIrStep(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  } else if (irStep?.kind === 'done') {
    const { plan, toIr } = irStep;
    body = (
      <div className="stack">
        <p>
          {p.name} {toIr ? 'moved to IR' : 'moved off IR'}. {selected.name}: {plan.before} → {plan.after} games fit your lineup.
        </p>
        <h3 className="sheet-sub">What changed</h3>
        <ChangeList changes={plan.changes} emptyText={`No lineup changes in ${selected.name}.`} />
        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  } else {
    // Simplified sheet (2026-11-26): the player's identity in the title, then every valid action as one flat
    // list (no headings, explanations or disclosure). A saved change closes the sheet.
    const kind = gameKind(day, playerId, byId, seats);
    const replacements = seat ? replaceOptions(day, playerId, lineupPlayers, seats) : [];
    const moves = seat ? moveOptions(day, playerId, lineupPlayers, seats).filter((x) => x.seatKey) : [];
    const bench = seat ? moveOptions(day, playerId, lineupPlayers, seats).find((x) => !x.seatKey) : undefined;
    const adds = !seat && !p.onIr && m.game ? addOptions(day, playerId, lineupPlayers, seats) : [];
    const places = !seat && !p.onIr && !m.game ? placeOptions(day, playerId, lineupPlayers, seats) : [];
    const act = (next: Lineup) => {
      if (save(date, next)) onClose();
    };
    body = (
      <div className="stack">
        <div className="sheet-options" aria-label="Lineup actions">
          {moves.map((x) => (
            <button key={`m-${x.seatKey}`} className="option-btn" onClick={() => act(x.next)}>
              <span>
                Move to {x.seatLabel}
                {x.withId ? <span className="small muted"> · swap with {name(x.withId)}</span> : null}
              </span>
            </button>
          ))}
          {replacements.map((o) => (
            <button
              key={`r-${o.inId}`}
              className="option-btn"
              onClick={() => setPending({ inId: o.inId, outId: playerId, seatLabel: o.seatLabel, gain: o.gain, lose: o.lose, next: o.next })}
            >
              <span>
                Replace with <b>{name(o.inId)}</b>
              </span>
              <span className="small">
                {o.gain ? <span className="gain-text">Gain {matchupOf(day, o.inId).text}</span> : <span className="muted">No game gained</span>} ·{' '}
                {o.lose ? <span className="lose-text">Give up {m.text}</span> : <span className="muted">no game given up</span>}
                {o.net !== 0 && <b className={o.net > 0 ? 'gain-text' : 'lose-text'}> ({o.net > 0 ? '+1' : '−1'} game)</b>}
              </span>
            </button>
          ))}
          {bench && (
            <button className="option-btn lose" onClick={() => act(bench.next)}>
              <span>
                Remove from lineup <span className="small muted">· {m.game ? 'gives up this game' : 'no game'}</span>
              </span>
            </button>
          )}
          {adds.map((o) =>
            o.kind === 'open' ? (
              <button key={`o-${o.seatKey}`} className="option-btn gain" onClick={() => act(o.next)}>
                <span>
                  Add at {o.seatLabel}
                  {o.outId ? <span className="small muted"> · {name(o.outId)} (no game) goes to the bench</span> : null}
                </span>
              </button>
            ) : (
              <button
                key={`s-${o.outId}`}
                className="option-btn"
                onClick={() => setPending({ inId: playerId, outId: o.outId!, seatLabel: o.seatLabel, gain: o.gain, lose: o.lose, next: o.next })}
              >
                <span>
                  Start instead of <b>{name(o.outId!)}</b> at {o.seatLabel}
                  {o.suggested && <span className="badge good" style={{ marginLeft: 6 }}>Suggested</span>}
                </span>
                <span className="small">
                  <span className="gain-text">Gain {m.text}</span> · <span className="lose-text">Give up {matchupOf(day, o.outId!).text}</span>
                </span>
              </button>
            ),
          )}
          {places.map((o) =>
            o.lose ? (
              <button
                key={`p-${o.seatKey}`}
                className="option-btn"
                onClick={() => setPending({ inId: playerId, outId: o.outId!, seatLabel: o.seatLabel, gain: o.gain, lose: o.lose, next: o.next })}
              >
                <span>
                  Put in at {o.seatLabel} instead of <b>{name(o.outId!)}</b>
                </span>
                <span className="small">
                  <span className="lose-text">Give up {matchupOf(day, o.outId!).text}</span> <b className="lose-text">(−1 game)</b>
                </span>
              </button>
            ) : (
              <button key={`p-${o.seatKey}`} className="option-btn" onClick={() => act(o.next)}>
                <span>
                  Put in at {o.seatLabel}
                  <span className="small muted"> · {o.outId ? `${name(o.outId)} (no game) goes to the bench` : 'empty slot, adds no game'}</span>
                </span>
              </button>
            ),
          )}
          {/* IR action: in both the Set Lineup and the Team Schedule panel (Team Schedule since 2026-11-26). */}
          {p.onIr ? (
            <button className="option-btn" onClick={() => setIrStep({ kind: 'confirm', toIr: false, plan: planIrChange(playerId, false, lineupPlayers, selected.dates, seats, data.schedule, state.manual) })}>
              Move off IR
            </button>
          ) : (
            <button
              className="option-btn"
              disabled={irFull}
              onClick={() => setIrStep({ kind: 'confirm', toIr: true, plan: planIrChange(playerId, true, lineupPlayers, selected.dates, seats, data.schedule, state.manual) })}
            >
              <span>
                Move to IR
                {irFull && <span className="small muted"> · your IR slots are full ({irCount} of {state.league.irSlots})</span>}
              </span>
            </button>
          )}
        </div>
        {!seat && !p.onIr && m.game && kind === 'constraint' && <p className="small muted">No lineup slot in your league accepts {p.positions.join('/')}.</p>}
        {onOpenInLineup && (
          <button className="btn small" onClick={onOpenInLineup}>
            Open {when} in Set Lineup
          </button>
        )}
      </div>
    );
  }
  return (
    <Sheet label={`${p.name}: details and replacements`} title={title} onClose={onClose}>
      {body}
    </Sheet>
  );
}

/** Fill an empty lineup slot with any eligible bench player (2026-11-24); players with a game first. */
function FillSheet({ date, seatKey, onClose }: { date: ISODate; seatKey: string; onClose: () => void }) {
  const { days, lineupPlayers } = useApp();
  const seats = useSeats();
  const save = useSaveDay();
  const day = days.get(date);
  const seat = seats.find((s) => s.key === seatKey);
  if (!day || !seat) return null;
  const byId = new Map(lineupPlayers.map((p) => [p.id, p]));
  const filled = day.seats.find((x) => x.seat.key === seatKey)?.playerId;
  const candidates = filled ? [] : fillCandidates(day, seatKey, lineupPlayers, seats);
  return (
    <Sheet label={`Fill the ${seat.label} slot`} title={<b>Fill the {seat.label} slot · {weekday(date)} {formatShort(date)}</b>} onClose={onClose}>
      {filled ? (
        <p>This slot is now filled by {byId.get(filled)?.name}.</p>
      ) : candidates.length === 0 ? (
        <p className="small muted">No bench player on your roster can play {seat.label}.</p>
      ) : (
        <div className="sheet-options">
          {candidates.map(({ playerId, option }) => {
            const p = byId.get(playerId)!;
            const m = matchupOf(day, playerId);
            return (
              <button
                key={playerId}
                className={`option-btn ${option.gain ? 'gain' : ''}`}
                onClick={() => {
                  save(date, option.next);
                  onClose();
                }}
              >
                <span>
                  <b>{p.name}</b> <PosBadges positions={p.positions} /> <span className={`small ${m.game ? '' : 'muted'}`}>{m.text}</span>
                </span>
                <span className="small">{option.gain ? <span className="gain-text">Adds a game (+1)</span> : <span className="muted">No game: fills the slot only</span>}</span>
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
