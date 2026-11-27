import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { formatShort, weekday } from '../domain/dates.ts';
import { isLightNight, rankTeams } from '../domain/rankings.ts';
import { opponent } from '../domain/schedule.ts';
import { formatRosterList, gridCell, matchupsOn, nextSort, rosterPlayersByTeam, sortTeamRows, type RosteredPlayer, type SortState, type TeamRow } from '../domain/teamSchedules.ts';
import type { ISODate, TeamId } from '../domain/types.ts';
import { useApp, type Window } from './context.ts';
import { StickyHeadTable } from './StickyHead.tsx';

/** Schedules tab: Games per Night and the NHL Team Schedules table, governed by the selected date range. */
export function RankingsView({ onGoRoster }: { onGoRoster: () => void }) {
  return (
    <div className="stack">
      <TeamRankings onGoRoster={onGoRoster} />
    </div>
  );
}

/** Grid tab: the Schedule Grid, governed by the selected date range (its own tab since 2026-11-24). */
export function GridView() {
  return (
    <div className="stack">
      <ScheduleGrid />
    </div>
  );
}

/** Games a team plays on the window's dates (for "Full playoffs", only dates inside the rounds). */
function useGamesInWindow() {
  const { data } = useApp();
  return (team: TeamId, w: Window) => {
    const dates = new Set(w.dates);
    return data.schedule.teamGames(team, w.start, w.end).filter((g) => dates.has(g.date)).length;
  };
}

function useRosterByTeam() {
  const { state, resolve } = useApp();
  return useMemo(() => rosterPlayersByTeam(state.roster, resolve), [state.roster, resolve]);
}

interface Column {
  key: string;
  label: string;
  title: string;
}

function TeamRankings({ onGoRoster }: { onGoRoster: () => void }) {
  const { data, playoffWindows, selected, state } = useApp();
  const teamIds = useMemo(() => data.teams.map((t) => t.id), [data.teams]);
  const gamesIn = useGamesInWindow();
  const byTeam = useRosterByTeam();
  const [expanded, setExpanded] = useState<{ team: TeamId; kind: 'games' | 'players' } | null>(null);
  const isAll = selected.id === 'all';
  const rounds = playoffWindows.filter((w) => w.id !== 'all');
  const allWindow = playoffWindows.find((w) => w.id === 'all');

  // Columns follow the selected range. "Full playoffs" shows its rounds as a breakdown of the same
  // dates; a single round or custom range shows its own games, plus a labeled all-rounds summary.
  const gameCols: Column[] = isAll
    ? [
        ...rounds.map((r) => ({ key: `round:${r.id}`, label: r.name, title: `${formatShort(r.start)} – ${formatShort(r.end)}` })),
        { key: 'games', label: 'Total', title: `All games in ${selected.name}` },
      ]
    : [{ key: 'games', label: 'Games', title: `Games in ${selected.name} (${formatShort(selected.start)} – ${formatShort(selected.end)})` }];
  // Next Week is about the week ahead: no Full Playoffs context column there.
  const summaryCol: Column | null =
    !isAll && selected.id !== 'week' && allWindow ? { key: 'summary', label: 'Full Playoffs', title: 'All rounds combined, for context. Not limited to the selected range.' } : null;
  const numericKeys = [...gameCols.map((c) => c.key), 'light', ...(summaryCol ? ['summary'] : []), 'mine'];

  const defaultSort: SortState = { key: 'games', dir: 'desc' };
  const [sort, setSort] = useState<SortState>(defaultSort);
  // A column can disappear when the range changes; fall back to the default.
  const activeSort = sort.key === 'team' || numericKeys.includes(sort.key) ? sort : defaultSort;

  const light = useMemo(
    () => rankTeams(data.schedule, teamIds, isAll ? state.periods : [{ start: selected.start, end: selected.end }]),
    [data.schedule, teamIds, selected, isAll, state.periods],
  );
  const lightBy = new Map(light.map((r) => [r.team, r.lightNight]));

  const rows: TeamRow[] = teamIds.map((team) => {
    const values: Record<string, number> = {
      games: gamesIn(team, selected),
      light: lightBy.get(team) ?? 0,
      mine: byTeam.get(team)?.length ?? 0,
    };
    if (isAll) for (const r of rounds) values[`round:${r.id}`] = gamesIn(team, r);
    if (summaryCol && allWindow) values.summary = gamesIn(team, allWindow);
    return { team, values };
  });
  const sorted = sortTeamRows(rows, activeSort, ['games', 'light']);

  const sortTh = (key: string, label: string, title: string, extra = '') => {
    const isActive = activeSort.key === key;
    return (
      <th
        className={`sortable ${key === 'team' ? '' : 'n'} ${extra} ${isActive ? 'active' : ''}`}
        title={`${title}. Click to sort${isActive ? '; click again to reverse' : ''}.`}
        aria-sort={isActive ? (activeSort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
        onClick={() => setSort(nextSort(activeSort, key))}
      >
        {label}
        {isActive ? (activeSort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
      </th>
    );
  };
  const toggle = (team: TeamId, kind: 'games' | 'players') =>
    setExpanded(expanded?.team === team && expanded.kind === kind ? null : { team, kind });
  const colCount = 2 + gameCols.length + 1 + (summaryCol ? 1 : 0) + 1;

  return (
    <>
      <GamesPerNight />
      <RosterPill onGoRoster={onGoRoster} />
      <section className="panel">
        <div className="panel-head">
          <h2>NHL Team Schedules</h2>
        </div>
        <StickyHeadTable
          tableClass={`team-table ${selected.id === 'week' ? 'next-week' : ''}`}
          scrollClass="table-wrap"
          head={
              <tr>
                <th className="n">#</th>
                {sortTh('team', 'Team', 'Team name')}
                {gameCols.map((c) => (
                  <Fragment key={c.key}>{sortTh(c.key, c.label, c.title)}</Fragment>
                ))}
                {sortTh('light', 'Light-Night Games', `Games on nights with 8 or fewer NHL games, in ${selected.name}. Those games compete with fewer of your other players for lineup spots`)}
                {summaryCol && sortTh(summaryCol.key, summaryCol.label, summaryCol.title, 'summary-col')}
                {sortTh('mine', 'Your Players', 'Players on your roster from this team. Click a count to see them')}
              </tr>
          }
        >
            <tbody>
              {sorted.map((r, idx) => {
                const players = byTeam.get(r.team) ?? [];
                return (
                  <Fragment key={r.team}>
                    <tr onClick={() => toggle(r.team, 'games')} style={{ cursor: 'pointer' }}>
                      <td className="n muted">{idx + 1}</td>
                      <td>
                        <div className="team-cell">
                          <span className="team-abbr">{r.team}</span>
                          <span className="muted small">{data.teams.find((t) => t.id === r.team)?.name}</span>
                          {/* Expansion cue (2026-11-26): the whole row still toggles; this is its accessible control. */}
                          {(() => {
                            const open = expanded?.team === r.team && expanded.kind === 'games';
                            return (
                              <button
                                type="button"
                                className={`team-chev ${open ? 'open' : ''}`}
                                aria-expanded={open}
                                aria-label={`${open ? 'Hide' : 'Show'} ${r.team} game dates`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggle(r.team, 'games');
                                }}
                              >
                                <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
                                  <path d="M3.5 6 8 10.5 12.5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            );
                          })()}
                        </div>
                      </td>
                      {gameCols.map((c) => (
                        <td key={c.key} className={`n ${c.key === 'games' ? 'col-selected' : ''}`}>
                          {r.values[c.key]}
                        </td>
                      ))}
                      <td className="n">{r.values.light}</td>
                      {summaryCol && <td className="n summary-col">{r.values.summary}</td>}
                      <td className="n">
                        <MinePill team={r.team} count={players.length} open={expanded?.team === r.team && expanded.kind === 'players'} onToggle={() => toggle(r.team, 'players')} />
                      </td>
                    </tr>
                    {expanded?.team === r.team && (
                      <tr className="expand-row">
                        <td />
                        <td colSpan={colCount - 1}>{expanded.kind === 'games' ? <TeamGames team={r.team} /> : <TeamPlayers team={r.team} players={players} />}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
        </StickyHeadTable>
      </section>
    </>
  );
}

/** Invitation to My Team › My Roster before a roster exists; nothing once it has players (that tab shows the count). */
function RosterPill({ onGoRoster }: { onGoRoster: () => void }) {
  const { state } = useApp();
  if (state.roster.length > 0) return null;
  return (
    <button type="button" className="roster-pill" onClick={onGoRoster}>
      + Add your roster
    </button>
  );
}

/** League-wide games per night in the selected range; each bar reveals that night's matchups on demand. */
function GamesPerNight() {
  const { data, selected } = useApp();
  // Hover (mouse) and keyboard focus show a floating tooltip only, so nothing moves; a click or tap
  // pins the night and opens its matchups below the chart (2026-11-26).
  const [tip, setTip] = useState<{ d: ISODate; x: number } | null>(null);
  const [pinned, setPinned] = useState<ISODate | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const showTip = (d: ISODate, el: HTMLElement) => {
    const s = strip.current;
    if (!s) return;
    setTip({ d, x: el.offsetLeft - s.scrollLeft + el.offsetWidth / 2 });
  };
  useEffect(() => {
    if (pinned && !selected.dates.includes(pinned)) setPinned(null);
  }, [selected, pinned]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPinned(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const nights = selected.dates.map((d) => ({ d, n: data.schedule.gamesOn(d).length }));
  const maxNight = Math.max(1, ...nights.map((x) => x.n));
  const lightCount = nights.filter((x) => isLightNight(x.n, data.teams.length)).length;
  const active = pinned;
  const matchups = active ? matchupsOn(data.schedule, active) : [];
  const tipNight = tip && nights.find((x) => x.d === tip.d);
  const wrapW = strip.current?.clientWidth ?? 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Games per Night</h2>
        <span className="legend">
          <span>
            <i style={{ background: 'var(--good)' }} />
            Light night: 8 or fewer games ({lightCount} in range)
          </span>
        </span>
      </div>
      <div className="panel-body" style={{ paddingTop: 6, paddingBottom: 6 }}>
        <div className="strip-wrap">
        {tip && tipNight && (
          <div
            className="strip-tip"
            aria-hidden="true"
            style={{ left: tip.x, transform: `translateX(${tip.x < 60 ? '-15%' : wrapW && tip.x > wrapW - 60 ? '-85%' : '-50%'})` }}
          >
            {weekday(tip.d)} {formatShort(tip.d)} · {tipNight.n} {tipNight.n === 1 ? 'game' : 'games'}
          </div>
        )}
        <div ref={strip} className={`strip ${pinned ? 'has-pinned' : ''}`} aria-label="NHL games per date" onScroll={() => setTip(null)}>
          {nights.map(({ d, n }) => (
            <button
              key={d}
              type="button"
              className={`bar-col ${active === d ? 'active' : ''}`}
              aria-label={`${weekday(d)} ${formatShort(d)}: ${n} games. Show matchups.`}
              aria-pressed={pinned === d}
              onPointerEnter={(e) => e.pointerType === 'mouse' && showTip(d, e.currentTarget)}
              onPointerLeave={() => setTip(null)}
              onFocus={(e) => e.currentTarget.matches(':focus-visible') && showTip(d, e.currentTarget)}
              onBlur={() => setTip(null)}
              onClick={() => setPinned(pinned === d ? null : d)}
            >
              <div className={`bar ${isLightNight(n, data.teams.length) ? 'light' : ''}`} style={{ height: `${(n / maxNight) * 44}px` }} />
              <span className="lbl">{d.slice(8).replace(/^0/, '')}</span>
            </button>
          ))}
        </div>
        </div>
        <div className="night-detail" aria-live="polite">
          {active ? (
            <>
              <b>
                {weekday(active)} {formatShort(active)} · {matchups.length} {matchups.length === 1 ? 'game' : 'games'}
              </b>
              <span className="game-chips">
                {matchups.map((m) => (
                  <span key={m.id} className="game-chip">
                    {m.away} @ {m.home}
                  </span>
                ))}
                {matchups.length === 0 && <span className="muted">No NHL games.</span>}
              </span>
              <button className="icon-btn" aria-label="Close matchups" onClick={() => setPinned(null)}>
                ✕
              </button>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TeamGames({ team }: { team: string }) {
  const { data, selected } = useApp();
  const dates = new Set(selected.dates);
  const games = data.schedule.teamGames(team, selected.start, selected.end).filter((g) => dates.has(g.date));
  if (games.length === 0) return <span className="muted">No games in {selected.name}.</span>;
  return (
    <div className="game-chips">
      {games.map((g) => {
        const o = opponent(g, team);
        const light = isLightNight(data.schedule.gamesOn(g.date).length, data.teams.length);
        return (
          <span key={g.id} className={`game-chip ${light ? 'light' : ''}`} title={light ? 'Light night' : undefined}>
            {weekday(g.date)} {formatShort(g.date)} · {o.home ? 'vs' : '@'} {o.team}
          </span>
        );
      })}
    </div>
  );
}

/** Blue-dot count of your players on a team; toggles their list. Shared by Team Schedules and the Grid (2026-11-26). */
function MinePill({ team, count, open, onToggle }: { team: TeamId; count: number; open: boolean; onToggle: () => void }) {
  if (count === 0)
    return (
      <span className="muted" title="None of your players">
        –
      </span>
    );
  return (
    <button
      className="mine-btn"
      aria-expanded={open}
      aria-label={`${count} of your players on ${team}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <span className="mine-dot" /> {count}
    </button>
  );
}

/** The team's rostered players as one compact line, e.g. "Leo Carlsson (C), Lukas Dostal (G)" (no heading). */
function TeamPlayers({ team, players }: { team: TeamId; players: RosteredPlayer[] }) {
  return (
    <div className="team-players" aria-label={`Your players on ${team}`}>
      {formatRosterList(players)}
    </div>
  );
}

/** The Grid's default order: most games first (ties A→Z by team, `sortTeamRows`). */
export const GRID_DEFAULT_SORT: SortState = { key: 'games', dir: 'desc' };

/** Team-by-date matrix for the selected range: opponent on game days, blank on off-days. */
function ScheduleGrid() {
  const { data, selected } = useApp();
  const gamesIn = useGamesInWindow();
  const byTeam = useRosterByTeam();
  // Default (2026-11-26): most games in the selected period first, ties A→Z by team; recomputed for each period.
  // A column the user picks (Team, Your Players, Games) stays selected while they use the Grid.
  const [sort, setSort] = useState<SortState>(GRID_DEFAULT_SORT);
  const [openTeam, setOpenTeam] = useState<TeamId | null>(null);
  // "mine" sorts on the number of your players on the team (numeric), like Team Schedules.
  const rows = sortTeamRows(
    data.teams.map((t) => ({ team: t.id, values: { games: gamesIn(t.id, selected), mine: byTeam.get(t.id)?.length ?? 0 } })),
    sort,
    ['games'],
  );
  const cols = selected.dates.length + 3;
  const head = (key: string, label: string, cls: string) => (
    <th
      className={`sortable ${cls} ${sort.key === key ? 'active' : ''}`}
      aria-sort={sort.key === key ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
      onClick={() => setSort(nextSort(sort, key))}
    >
      {label}
      {sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Schedule Grid</h2>
        <span className="small muted">
          {selected.name}, {formatShort(selected.start)} – {formatShort(selected.end)}
        </span>
      </div>
      <StickyHeadTable
        tableClass="sgrid"
        scrollClass="grid-wrap"
        head={
          <>
            <tr className="nightly">
              <th className="sticky" title="NHL games scheduled league-wide on each date">
                NHL Games
              </th>
              {selected.dates.map((d, i) => (
                <th key={d} className={weekday(d) === 'Mon' && i > 0 ? 'wk' : ''} title={`${weekday(d)} ${formatShort(d)} · ${data.schedule.gamesOn(d).length} NHL games`}>
                  {data.schedule.gamesOn(d).length}
                </th>
              ))}
              <th />
              <th />
            </tr>
            <tr>
              {head('team', 'Team', 'sticky')}
              {selected.dates.map((d, i) => (
                <th
                  key={d}
                  className={`dcol ${weekday(d) === 'Mon' && i > 0 ? 'wk' : ''}`}
                  title={`${weekday(d)} ${formatShort(d)} · ${data.schedule.gamesOn(d).length} NHL games`}
                >
                  {weekday(d)}
                  <br />
                  {formatShort(d).replace(' ', ' ')}
                </th>
              ))}
              {head('mine', 'Your Players', 'sg-mine')}
              {head('games', 'Games', 'n')}
            </tr>
          </>
        }
      >
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.team}>
              <tr>
                <th className="sticky" scope="row" title={data.teams.find((t) => t.id === r.team)?.name}>
                  {r.team} {byTeam.get(r.team)?.length ? <span className="mine-dot" title="You have players on this team" /> : null}
                </th>
                {selected.dates.map((d, i) => {
                  const c = gridCell(data.schedule, r.team, d);
                  return (
                    <td
                      key={d}
                      className={`${c ? 'game' : 'off'} ${weekday(d) === 'Mon' && i > 0 ? 'wk' : ''}`}
                      title={c ? `${formatShort(d)}: ${c.home ? 'vs' : 'at'} ${c.opponent}` : `${formatShort(d)}: no game`}
                    >
                      {c?.label ?? ''}
                    </td>
                  );
                })}
                {/* Your players on this team: the same blue-dot count and expanded list as Team Schedules (2026-11-26). */}
                <td className="sg-mine">
                  <MinePill team={r.team} count={r.values.mine ?? 0} open={openTeam === r.team} onToggle={() => setOpenTeam(openTeam === r.team ? null : r.team)} />
                </td>
                <td className="n">{r.values.games}</td>
              </tr>
              {openTeam === r.team && (
                <tr className="expand-row sg-expand">
                  <td colSpan={cols}>
                    <div className="sg-expand-in">
                      <TeamPlayers team={r.team} players={byTeam.get(r.team) ?? []} />
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
      </StickyHeadTable>
    </section>
  );
}
