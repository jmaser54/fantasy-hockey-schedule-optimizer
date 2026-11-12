import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { formatShort, weekday } from '../domain/dates.ts';
import { expandSeats, moveInLineup, optimizeDay, type DayResult, type LineupPlayer, type UnusedReason } from '../domain/optimizer.ts';
import { opponent } from '../domain/schedule.ts';
import type { ISODate } from '../domain/types.ts';
import { dailyGroupCounts, lineupGroupTotals } from '../domain/capacity.ts';
import { useApp, type Window } from './context.ts';
import { PosBadges, PreferredToggle } from './common.tsx';

export function LineupView({ onGoRoster }: { onGoRoster: () => void }) {
  const { state, selected, lineupPlayers, dispatch, summarizeWindow, days } = useApp();
  const [day, setDay] = useState<ISODate | null>(null);
  const editorRef = useRef<HTMLElement>(null);
  const scrollToEditor = useRef(false);
  useEffect(() => {
    if (day && !selected.dates.includes(day)) setDay(null);
  }, [selected, day]);
  // Bring the day editor into view, below the sticky tab bar.
  const showEditor = () => {
    if (!editorRef.current) return;
    const header = document.querySelector('.tabbar')?.getBoundingClientRect().height ?? 0;
    const top = editorRef.current.getBoundingClientRect().top + window.scrollY - header - 8;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
  };
  // A date picked in the grid opens its editor in view (arrow navigation inside the editor doesn't scroll).
  useEffect(() => {
    if (!day || !scrollToEditor.current) return;
    scrollToEditor.current = false;
    showEditor();
  }, [day]);
  const pickDay = (d: ISODate) => {
    const next = d === day ? null : d;
    scrollToEditor.current = next !== null;
    setDay(next);
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

  const summary = summarizeWindow(selected);
  const manualDates = selected.dates.filter((d) => days.get(d)?.manual);
  const issueDates = selected.dates.filter((d) => days.get(d)?.manualIssues.length);

  return (
    <div className="stack">
      <SummaryCards />
      <section className="panel">
        <div className="panel-head">
          <h2>
            {selected.name}: {summary.usable} of {summary.scheduled} scheduled games fit your lineup
          </h2>
          {manualDates.length > 0 && (
            <>
              <span className="badge manual" title="Days where you swapped players. Other days are fully optimized.">
                Your changes on {manualDates.length} day{manualDates.length === 1 ? '' : 's'}
                {summary.usable < summary.optimalUsable ? ` · optimal ${summary.optimalUsable}` : ''}
              </span>
              {issueDates.length > 0 && (
                <button className="badge warn" style={{ border: 0, cursor: 'pointer' }} onClick={() => setDay(issueDates[0]!)} title={issueDates.map(formatShort).join(', ')}>
                  {issueDates.length} day{issueDates.length === 1 ? ' has' : 's have'} changes that no longer apply
                </button>
              )}
              <button
                className="btn small"
                onClick={() => {
                  if (confirm(`Remove your lineup changes on ${manualDates.length} day${manualDates.length === 1 ? '' : 's'} in ${selected.name}?`)) dispatch({ type: 'clearManual', dates: manualDates });
                }}
              >
                Reset {selected.name} to Optimal
              </button>
            </>
          )}
        </div>
        <Legend />
        <p className="grid-hint small">
          {day ? (
            <>
              Editing <b>{weekday(day)} {formatShort(day)}</b> ·{' '}
              <button className="link-btn" onClick={showEditor}>
                Go to lineup editor ↓
              </button>
            </>
          ) : (
            'Tap a day to change that day’s lineup.'
          )}
        </p>
        <LineupGrid window={selected} players={lineupPlayers} selectedDay={day} onSelectDay={pickDay} />
      </section>
      {day && days.get(day) && <DayDetail day={days.get(day)!} onNav={(d) => setDay(d)} dates={selected.dates} sectionRef={editorRef} />}
    </div>
  );
}

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
            <div className="sub" title="Scheduled games of your non-IR players that are in your final daily lineups">games fit your lineup</div>
            <div className="sub">
              <span title={`In lineup / scheduled games in ${w.name}, summed from the player rows (players on IR excluded)`}>
                <span style={{ whiteSpace: 'nowrap' }}>Skaters {t.skaters.inLineup}/{t.skaters.scheduled}</span> ·{' '}
                <span style={{ whiteSpace: 'nowrap' }}>Goalies {t.goalies.inLineup}/{t.goalies.scheduled}</span>
              </span>
              {s.manualDays ? <> · <span className="badge manual" title={`Your changes on ${s.manualDays} day${s.manualDays === 1 ? '' : 's'}`}>edited</span></> : null}
            </div>
            <div className="meter">
              <div style={{ width: `${pct}%` }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <div className="panel-body legend" style={{ paddingBottom: 0 }}>
      <span>
        <span className="cell used" /> In lineup
      </span>
      <span>
        <span className="cell unused" /> Game, no open slot
      </span>
      <span>
        <span className="cell ir" /> On IR
      </span>
      <span>
        <span className="star" aria-hidden="true" style={{ color: 'var(--warn)' }}>★</span> Preferred: gets lineup spots first
      </span>
      <span>
        <b className="count-key">Skaters, Goalies</b> rows: players with a game / active lineup slots
      </span>
    </div>
  );
}

function LineupGrid(props: { window: Window; players: LineupPlayer[]; selectedDay: ISODate | null; onSelectDay: (d: ISODate) => void }) {
  const { days, data, summarizeWindow, state } = useApp();
  const summary = summarizeWindow(props.window);
  const totals = new Map(summary.players.map((p) => [p.playerId, p]));
  const isGoalie = (p: LineupPlayer) => p.positions.every((x) => x === 'G');
  const groups = [
    { label: 'Skaters', rows: props.players.filter((p) => !p.onIr && !isGoalie(p)) },
    { label: 'Goalies', rows: props.players.filter((p) => !p.onIr && isGoalie(p)) },
    { label: 'IR', rows: props.players.filter((p) => p.onIr) },
  ].filter((g) => g.rows.length);
  const statusOf = (d: DayResult, id: string) => d.players.find((x) => x.playerId === id);
  const counts = new Map(props.window.dates.map((d) => [d, dailyGroupCounts(days.get(d)!, props.players, state.league.slots)]));
  const countRow = (group: 'skaters' | 'goalies', label: string) => (
    <tr className="count-row">
      <th className="sticky" title={`${label} with a game that day / active ${label.toLowerCase()} lineup slots`}>
        {label}
      </th>
      {props.window.dates.map((d) => {
        const c = counts.get(d)![group];
        return (
          <th
            key={d}
            className={`cnt ${c.available > c.capacity ? 'over' : ''} ${props.selectedDay === d ? 'sel' : ''}`}
            title={`${formatShort(d)}: ${c.available} ${label.toLowerCase()} with a game, ${c.capacity} active slots`}
            onClick={() => props.onSelectDay(d)}
          >
            {c.available}/{c.capacity}
          </th>
        );
      })}
      <th />
    </tr>
  );

  return (
    <div className="grid-wrap">
      <table className="lgrid">
        <thead>
          {countRow('skaters', 'Skaters')}
          {countRow('goalies', 'Goalies')}
          <tr>
            <th className="sticky">Player</th>
            {props.window.dates.map((d) => (
              <th
                key={d}
                className={`dh ${props.selectedDay === d ? 'sel' : ''} ${days.get(d)?.manualIssues.length ? 'issue' : days.get(d)?.manual ? 'man' : ''}`}
              >
                <button
                  type="button"
                  className="day-btn"
                  aria-pressed={props.selectedDay === d}
                  aria-label={`${weekday(d)} ${formatShort(d)}${days.get(d)?.manual ? ', your changes' : ''}`}
                  onClick={() => props.onSelectDay(d)}
                  title={`${weekday(d)} ${formatShort(d)} · ${data.schedule.gamesOn(d).length} NHL games${days.get(d)?.manual ? ' · your changes' : ''}`}
                >
                  {weekday(d)[0]}
                  <br />
                  {Number(d.slice(8))}
                </button>
              </th>
            ))}
            <th className="tot" title="Games in your lineup / games scheduled for this player's team">
              In Lineup
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g.label} label={g.label} cols={props.window.dates.length}>
              {g.rows.map((p) => {
                const t = totals.get(p.id);
                return (
                  <tr key={p.id}>
                    <td className="sticky">
                      <PreferredToggle id={p.id} name={p.name} preferred={!!p.preferred} /> {p.name} <PosBadges positions={p.positions} />
                    </td>
                    {props.window.dates.map((d) => {
                      const day = days.get(d)!;
                      const st = statusOf(day, p.id);
                      let cls = '';
                      let title = '';
                      if (st?.game) {
                        const o = opponent(st.game, st.team);
                        title = `${formatShort(d)} ${o.home ? 'vs' : '@'} ${o.team}`;
                        cls = p.onIr ? 'ir' : st.seatKey ? 'used' : 'unused';
                        if (st.reason) title += ` — ${reasonText(st.reason)}`;
                      }
                      if (st?.choice === 'start') title += ' — you started this player';
                      return (
                        <td key={d} className={`c ${props.selectedDay === d ? 'sel' : ''}`} title={title} onClick={() => props.onSelectDay(d)}>
                          {cls && <span className={`cell ${cls}`} />}
                        </td>
                      );
                    })}
                    <td className="tot">
                      {t?.usable ?? 0}/{t?.scheduled ?? 0}
                    </td>
                  </tr>
                );
              })}
            </GroupRows>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="sticky small">In Lineup / Your Games</td>
            {props.window.dates.map((d) => {
              const day = days.get(d)!;
              return (
                <td key={d} title={`${day.usable} of ${day.scheduled} games fit your lineup${day.manual ? ` (your changes; optimal ${day.optimalUsable})` : ''}`} style={day.manual ? { color: 'var(--accent)' } : undefined}>
                  {day.scheduled ? `${day.usable}` : '·'}
                  <br />
                  <span style={{ fontWeight: 400 }}>{day.scheduled || ''}</span>
                </td>
              );
            })}
            <td className="tot">
              {summary.usable}/{summary.scheduled}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function GroupRows({ label, cols, children }: { label: string; cols: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="group">
        <td className="sticky" style={{ background: 'var(--surface-2)' }}>
          {label}
        </td>
        <td colSpan={cols + 1} />
      </tr>
      {children}
    </>
  );
}

export function reasonText(r: UnusedReason): string {
  switch (r.kind) {
    case 'ir':
      return 'on IR';
    case 'no-slot':
      return `no lineup slot accepts ${r.positions.join('/')}`;
    case 'slots-full':
      return `${r.slotLabels.join('/')} full (${r.occupants.join(', ')})`;
    case 'benched':
      return 'benched with an open slot';
    case 'sat':
      return 'sitting out by your choice';
  }
}

function DayDetail({ day, onNav, dates, sectionRef }: { day: DayResult; onNav: (d: ISODate) => void; dates: ISODate[]; sectionRef: RefObject<HTMLElement> }) {
  const { state, dispatch, lineupPlayers, data, teams, toast } = useApp();
  const seats = useMemo(() => expandSeats(state.league.slots), [state.league.slots]);
  const status = new Map(day.players.map((s) => [s.playerId, s]));
  const byId = new Map(lineupPlayers.map((p) => [p.id, p]));
  const idx = dates.indexOf(day.date);
  const nhlGames = data.schedule.gamesOn(day.date);
  // ESPN-style: tap a player's position button to move them; the positions they can take light up; tap one.
  // Only the players involved move.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [day.date]);

  const current: Record<string, string | null> = Object.fromEntries(day.seats.map((x) => [x.seat.key, x.playerId ?? null]));
  const seatOf = new Map(day.seats.flatMap((x) => (x.playerId ? [[x.playerId, x.seat] as const] : [])));
  const bench = lineupPlayers.filter((p) => !p.onIr && !seatOf.has(p.id));
  const ir = lineupPlayers.filter((p) => p.onIr && status.get(p.id)?.game);
  /** Save the day's exact lineup. Back to the automatic lineup clears the day's changes. */
  const apply = (next: Record<string, string | null>) => {
    const auto = optimizeDay(day.date, lineupPlayers, seats, data.schedule);
    const isAuto = auto.seats.every((x) => (x.playerId ?? null) === next[x.seat.key]);
    const start = Object.values(next).filter((x): x is string => !!x);
    dispatch({ type: 'setManual', date: day.date, override: isAuto ? null : { start, sit: [], lineup: next } });
    setPicked(null);
    toast('Lineup saved.');
  };
  const pickedPlayer = picked ? byId.get(picked) : undefined;
  const pickedSeat = picked ? seatOf.get(picked) : undefined;
  const moveTo = (seatKey: string | undefined, occupantId: string | undefined) =>
    picked ? moveInLineup(current, seats, byId, picked, seatKey, occupantId) : null;
  /** The position button beside a player (or an empty spot), as in ESPN's lineup editor. */
  const posButton = (label: string, seatKey: string | undefined, occupant: LineupPlayer | undefined) => {
    const isPicked = !!occupant && occupant.id === picked;
    const next = picked && !isPicked ? moveTo(seatKey, occupant?.id) : null;
    const where = seatKey ? label : 'the bench';
    if (isPicked)
      return (
        <button type="button" className="pos-btn picked" aria-pressed="true" aria-label={`Cancel moving ${occupant.name}`} onClick={() => setPicked(null)}>
          {label}
        </button>
      );
    if (next)
      return (
        <button type="button" className="pos-btn target" aria-label={occupant ? `Swap with ${occupant.name} (${label})` : `Move to empty ${where}`} onClick={() => apply(next)}>
          {label}
        </button>
      );
    return (
      <button
        type="button"
        className={`pos-btn ${picked ? 'off' : occupant ? '' : 'idle'}`}
        disabled={!!picked || !occupant}
        aria-label={occupant ? `Move ${occupant.name} (${label})` : `Empty ${label}`}
        onClick={() => occupant && setPicked(occupant.id)}
      >
        {label}
      </button>
    );
  };
  const matchup = (id: string) => {
    const st = status.get(id);
    if (!st?.game) return 'No game';
    const o = opponent(st.game, st.team);
    return `${o.home ? 'vs' : '@'} ${o.team}`;
  };
  const who = (p: LineupPlayer) => (
    <>
      <b>{p.name}</b> <PosBadges positions={p.positions} /> <span className={`small ${status.get(p.id)?.game ? '' : 'muted'}`}>{matchup(p.id)}</span>
    </>
  );
  return (
    <section className="panel day-editor" ref={sectionRef} aria-label={`Lineup editor for ${weekday(day.date)} ${formatShort(day.date)}`}>
      <div className="panel-head">
        <div className="day-nav">
          <button className="icon-btn" disabled={idx <= 0} onClick={() => onNav(dates[idx - 1]!)} aria-label="Previous day">
            ←
          </button>
          <button className="icon-btn" disabled={idx >= dates.length - 1} onClick={() => onNav(dates[idx + 1]!)} aria-label="Next day">
            →
          </button>
        </div>
        <h2>
          Lineup for {weekday(day.date)} {formatShort(day.date)}{' '}
          <span className="day-count">
            · {day.usable} of {day.scheduled} games fit your lineup
          </span>
        </h2>
        {day.manual ? (
          <>
            <span className="badge manual">Your Changes</span>
            <button className="btn small" onClick={() => dispatch({ type: 'setManual', date: day.date, override: null })}>
              Reset Day to Optimal
            </button>
          </>
        ) : (
          <span className="badge good">Optimized</span>
        )}
      </div>
      <div className="panel-body">
        {day.manualIssues.length > 0 && (
          <div className="notice" style={{ marginBottom: 12 }}>
            Some of your changes for this day no longer apply and are being ignored: {day.manualIssues.join(' ')}
          </div>
        )}
        <p className="section-hint swap-hint" aria-live="polite">
          {pickedPlayer ? (
            <>
              Moving <b>{pickedPlayer.name}</b>: tap a highlighted position.{' '}
              <button className="link-btn" onClick={() => setPicked(null)}>
                Cancel
              </button>
            </>
          ) : (
            'Tap a player’s position to move them.'
          )}
        </p>
        <div className="day-grid">
          <div>
            <h3 style={{ marginTop: 0 }}>In Lineup</h3>
            {day.seats.map(({ seat, playerId }) => {
              const p = playerId ? byId.get(playerId) : undefined;
              return (
                <div className={`seat ${p && p.id === picked ? 'picking' : ''}`} key={seat.key}>
                  {posButton(seat.label, seat.key, p)}
                  <span className="who">{p ? who(p) : <span className="empty-seat">Empty</span>}</span>
                </div>
              );
            })}
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>Bench</h3>
            {bench.length === 0 && !pickedSeat && <div className="muted small">Everyone is in the lineup.</div>}
            {bench.map((p) => (
              <div className={`seat ${p.id === picked ? 'picking' : ''}`} key={p.id}>
                {posButton('BN', undefined, p)}
                <span className="who">{who(p)}</span>
              </div>
            ))}
            {pickedSeat && (
              <div className="seat">
                {posButton('BN', undefined, undefined)}
                <span className="who">
                  <span className="empty-seat">Empty</span>
                </span>
              </div>
            )}
            {ir.length > 0 && (
              <div className="small muted" style={{ marginTop: 8 }}>
                On IR: {ir.map((p) => p.name).join(', ')}
              </div>
            )}
          </div>
        </div>
        <h3>NHL games ({nhlGames.length})</h3>
        <div className="game-chips">
          {nhlGames.map((g) => (
            <span key={g.id} className="game-chip" title={`${teams.get(g.away)?.name} at ${teams.get(g.home)?.name}`}>
              {g.away} @ {g.home}
            </span>
          ))}
          {nhlGames.length === 0 && <span className="muted small">No NHL games.</span>}
        </div>
      </div>
    </section>
  );
}
