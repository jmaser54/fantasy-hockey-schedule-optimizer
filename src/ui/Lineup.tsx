import { useEffect, useMemo, useState } from 'react';
import { formatShort, weekday } from '../domain/dates.ts';
import { expandSeats, lineupFromDay, moveInLineup, type DayResult, type LineupPlayer, type UnusedReason } from '../domain/optimizer.ts';
import { opponent } from '../domain/schedule.ts';
import type { ISODate } from '../domain/types.ts';
import { dailyGroupCounts, sumGroupCounts } from '../domain/capacity.ts';
import { useApp, type Window } from './context.ts';
import { PosBadges } from './common.tsx';

export function LineupView({ onGoRoster }: { onGoRoster: () => void }) {
  const { state, selected, lineupPlayers, dispatch, summarizeWindow, days } = useApp();
  const [day, setDay] = useState<ISODate | null>(null);
  useEffect(() => {
    if (day && !selected.dates.includes(day)) setDay(null);
  }, [selected, day]);

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
              <span className="badge manual">
                Manual lineup on {manualDates.length} day{manualDates.length === 1 ? '' : 's'} · optimal {summary.optimalUsable}
              </span>
              <button className="btn small" onClick={() => dispatch({ type: 'clearManual', dates: manualDates })}>
                Reset to Optimal
              </button>
            </>
          )}
        </div>
        <Legend />
        <LineupGrid window={selected} players={lineupPlayers} selectedDay={day} onSelectDay={(d) => setDay(d === day ? null : d)} />
      </section>
      {day && days.get(day) && <DayDetail day={days.get(day)!} onNav={(d) => setDay(d)} dates={selected.dates} />}
      {!day && <p className="small muted" style={{ margin: 0 }}>Select a date to see that day’s lineup and change it.</p>}
    </div>
  );
}

function SummaryCards() {
  const { windows, selected, dispatch, summarizeWindow, state, lineupPlayers } = useApp();
  const shown = windows.filter((w) => w.id !== 'custom' || selected.id === 'custom');
  return (
    <div className="cards">
      {shown.map((w) => {
        const s = summarizeWindow(w);
        const pct = s.scheduled ? Math.round((s.usable / s.scheduled) * 100) : 0;
        // Display only: goalie game opportunities vs goalie slot-days, summed over the window's days.
        const g = sumGroupCounts(s.days, lineupPlayers, state.league.slots).goalies;
        return (
          <button key={w.id} className="card" aria-pressed={w.id === selected.id} onClick={() => dispatch({ type: 'select', selection: w.id })}>
            <div className="label">{w.name}</div>
            <div className="big">
              {s.usable} <small>of {s.scheduled}</small>
            </div>
            <div className="sub" title="Scheduled games that fit your optimized daily lineup">games fit your lineup</div>
            <div className="sub">
              <span title={`Goalie game opportunities / goalie lineup slots, summed over ${w.name}'s days. See the Goalies row in the grid for each day.`}>
                Goalies {g.available}/{g.capacity}
              </span>
              {s.manualDays ? <> · <span className="badge manual">manual</span></> : null}
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
        <span className="cell idle" /> Started with no game
      </span>
      <span>
        <span className="cell ir" /> On IR
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
                className={`dh ${props.selectedDay === d ? 'sel' : ''}`}
                onClick={() => props.onSelectDay(d)}
                title={`${weekday(d)} ${formatShort(d)} · ${data.schedule.gamesOn(d).length} NHL games`}
              >
                {weekday(d)[0]}
                <br />
                {Number(d.slice(8))}
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
                      {p.name} <PosBadges positions={p.positions} />
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
                      } else if (st?.seatKey) {
                        cls = 'idle';
                        title = `${formatShort(d)}: no game, but in your lineup`;
                      }
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
                <td key={d} title={`${day.usable} of ${day.scheduled} games fit your lineup${day.manual ? ` (optimal ${day.optimalUsable})` : ''}`} style={day.manual ? { color: 'var(--accent)' } : undefined}>
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
  }
}

function DayDetail({ day, onNav, dates }: { day: DayResult; onNav: (d: ISODate) => void; dates: ISODate[] }) {
  const { state, dispatch, lineupPlayers, data, teams } = useApp();
  const seats = useMemo(() => expandSeats(state.league.slots), [state.league.slots]);
  const status = new Map(day.players.map((s) => [s.playerId, s]));
  const idx = dates.indexOf(day.date);
  const nhlGames = data.schedule.gamesOn(day.date);

  const assign = (seatKey: string, playerId: string) => {
    const seat = seats.find((s) => s.key === seatKey)!;
    const current = lineupFromDay(day);
    let next;
    if (!playerId) {
      next = { ...current };
      delete next[seatKey];
    } else {
      next = moveInLineup(current, playerId, seat, seats, lineupPlayers);
    }
    dispatch({ type: 'setManual', date: day.date, lineup: next });
  };

  const bench = lineupPlayers.filter((p) => !status.get(p.id)?.seatKey);
  const withGame = bench.filter((p) => status.get(p.id)?.game);
  const without = bench.filter((p) => !status.get(p.id)?.game);

  return (
    <section className="panel">
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
          {weekday(day.date)} {formatShort(day.date)} · {day.usable} of {day.scheduled} games fit your lineup
        </h2>
        {day.manual ? (
          <>
            <span className="badge manual">Manual{day.usable < day.optimalUsable ? ` · optimal ${day.optimalUsable}` : ''}</span>
            <button className="btn small" onClick={() => dispatch({ type: 'setManual', date: day.date, lineup: null })}>
              Reset Day to Optimal
            </button>
          </>
        ) : (
          <span className="badge good">Optimal</span>
        )}
      </div>
      <div className="panel-body">
        {day.manualIssues.length > 0 && (
          <div className="notice" style={{ marginBottom: 12 }}>
            Some manual placements no longer apply: {day.manualIssues.join(' ')}
          </div>
        )}
        <div className="day-grid">
          <div>
            <h3 style={{ marginTop: 0 }}>Lineup</h3>
            {day.seats.map(({ seat, playerId }) => {
              const eligible = lineupPlayers.filter((p) => !p.onIr && p.positions.some((x) => seat.accepts.includes(x)));
              const hasGame = playerId ? !!status.get(playerId)?.game : false;
              return (
                <div className="seat" key={seat.key}>
                  <span className="slot">{seat.label}</span>
                  <select className={playerId && !hasGame ? 'nogame' : ''} value={playerId ?? ''} onChange={(e) => assign(seat.key, e.target.value)} aria-label={`${seat.label} slot`}>
                    <option value="">— Empty —</option>
                    {eligible.map((p) => {
                      const st = status.get(p.id);
                      const g = st?.game;
                      const o = g ? opponent(g, st!.team) : undefined;
                      return (
                        <option key={p.id} value={p.id}>
                          {p.name} {o ? `(${o.home ? 'vs' : '@'} ${o.team})` : '(no game)'}
                          {st?.seatKey && st.seatKey !== seat.key ? ' · in lineup' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              );
            })}
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>Bench</h3>
            {withGame.length === 0 && without.length === 0 && <div className="muted small">Nobody on the bench.</div>}
            {withGame.map((p) => {
              const st = status.get(p.id)!;
              const o = opponent(st.game!, st.team);
              return (
                <div className="bench-item" key={p.id}>
                  <b>{p.name}</b> <PosBadges positions={p.positions} /> <span className="small">{o.home ? 'vs' : '@'} {o.team}</span>
                  <div className="reason">{st.reason ? reasonText(st.reason) : ''}</div>
                </div>
              );
            })}
            {without.length > 0 && (
              <div className="small muted" style={{ marginTop: 8 }}>
                No game: {without.map((p) => p.name).join(', ')}
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
