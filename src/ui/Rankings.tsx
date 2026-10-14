import { Fragment, useEffect, useMemo, useState } from 'react';
import { formatShort, weekday } from '../domain/dates.ts';
import { isLightNight, rankTeams } from '../domain/rankings.ts';
import { opponent } from '../domain/schedule.ts';
import { gridCell, matchupsOn, nextSort, rosterPlayersByTeam, sortTeamRows, type RosteredPlayer, type SortState, type TeamRow } from '../domain/teamSchedules.ts';
import type { ISODate, TeamId } from '../domain/types.ts';
import { useApp, type Window } from './context.ts';
import { PosBadges } from './common.tsx';

type View = 'rankings' | 'grid';

/** Team Schedules page: Team Rankings (default) and Schedule Grid, both governed by the selected date range. */
export function RankingsView() {
  const [view, setView] = useState<View>('rankings');
  return (
    <div className="stack">
      <div className="segmented view-toggle" role="group" aria-label="Team schedules view">
        <button aria-pressed={view === 'rankings'} onClick={() => setView('rankings')}>
          Team Rankings
        </button>
        <button aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
          Schedule Grid
        </button>
      </div>
      {view === 'rankings' ? <TeamRankings /> : <ScheduleGrid />}
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

function TeamRankings() {
  const { data, windows, selected, state } = useApp();
  const teamIds = useMemo(() => data.teams.map((t) => t.id), [data.teams]);
  const gamesIn = useGamesInWindow();
  const byTeam = useRosterByTeam();
  const [expanded, setExpanded] = useState<{ team: TeamId; kind: 'games' | 'players' } | null>(null);
  const isAll = selected.id === 'all';
  const rounds = windows.filter((w) => w.id !== 'all' && w.id !== 'custom');
  const allWindow = windows.find((w) => w.id === 'all');

  // Columns follow the selected range. "Full playoffs" shows its rounds as a breakdown of the same
  // dates; a single round or custom range shows its own games, plus a labeled all-rounds summary.
  const gameCols: Column[] = isAll
    ? [
        ...rounds.map((r) => ({ key: `round:${r.id}`, label: r.name, title: `${formatShort(r.start)} – ${formatShort(r.end)}` })),
        { key: 'games', label: 'Total', title: `All games in ${selected.name}` },
      ]
    : [{ key: 'games', label: 'Games', title: `Games in ${selected.name} (${formatShort(selected.start)} – ${formatShort(selected.end)})` }];
  const summaryCol: Column | null =
    !isAll && allWindow ? { key: 'summary', label: 'Full playoffs', title: 'All rounds combined, for context. Not limited to the selected range.' } : null;
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
      <section className="panel">
        <div className="panel-head">
          <h2>NHL team schedules</h2>
          <span className="small muted">
            {selected.name}, {formatShort(selected.start)} – {formatShort(selected.end)}. Click a team for its dates.
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="n">#</th>
                {sortTh('team', 'Team', 'Team name')}
                {gameCols.map((c) => (
                  <Fragment key={c.key}>{sortTh(c.key, c.label, c.title, c.key === 'games' ? 'col-selected' : '')}</Fragment>
                ))}
                {sortTh('light', 'Light-night games', `Games on nights with 8 or fewer NHL games, in ${selected.name}. Those games compete with fewer of your other players for lineup spots`)}
                {summaryCol && sortTh(summaryCol.key, summaryCol.label, summaryCol.title, 'summary-col')}
                {sortTh('mine', 'Your players', 'Players on your roster from this team. Click a count to see them')}
              </tr>
            </thead>
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
                        {players.length > 0 ? (
                          <button
                            className="mine-btn"
                            aria-expanded={expanded?.team === r.team && expanded.kind === 'players'}
                            aria-label={`${players.length} of your players on ${r.team}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(r.team, 'players');
                            }}
                          >
                            <span className="mine-dot" /> {players.length}
                          </button>
                        ) : (
                          <span className="muted" title="None of your players">
                            –
                          </span>
                        )}
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
          </table>
        </div>
      </section>
    </>
  );
}

/** League-wide games per night in the selected range; each bar reveals that night's matchups on demand. */
function GamesPerNight() {
  const { data, selected } = useApp();
  const [hover, setHover] = useState<ISODate | null>(null);
  const [pinned, setPinned] = useState<ISODate | null>(null);
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
  const active = pinned ?? hover;
  const matchups = active ? matchupsOn(data.schedule, active) : [];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Games per night</h2>
        <span className="legend">
          <span>
            <i style={{ background: 'var(--good)' }} />
            Light night: 8 or fewer games ({lightCount} in range)
          </span>
        </span>
      </div>
      <div className="panel-body" style={{ paddingTop: 6, paddingBottom: 6 }}>
        <div className="strip" aria-label="NHL games per date">
          {nights.map(({ d, n }) => (
            <button
              key={d}
              type="button"
              className={`bar-col ${active === d ? 'active' : ''}`}
              aria-label={`${weekday(d)} ${formatShort(d)}: ${n} games. Show matchups.`}
              aria-pressed={pinned === d}
              onMouseEnter={() => setHover(d)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(d)}
              onBlur={() => setHover(null)}
              onClick={() => setPinned(pinned === d ? null : d)}
            >
              <div className={`bar ${isLightNight(n, data.teams.length) ? 'light' : ''}`} style={{ height: `${(n / maxNight) * 44}px` }} />
              <span className="lbl">{d.slice(8).replace(/^0/, '')}</span>
            </button>
          ))}
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
              {pinned && (
                <button className="icon-btn" aria-label="Close matchups" onClick={() => setPinned(null)}>
                  ✕
                </button>
              )}
            </>
          ) : (
            <span className="muted">Hover or tap a bar to see that night’s matchups.</span>
          )}
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

function TeamPlayers({ team, players }: { team: TeamId; players: RosteredPlayer[] }) {
  return (
    <div className="team-players">
      <b>
        Your players on {team} ({players.length})
      </b>
      {players.map((p) => (
        <span key={p.id} className="team-player">
          {p.name} <PosBadges positions={p.positions} />
          {p.onIr && <span className="badge">IR</span>}
        </span>
      ))}
    </div>
  );
}

/** Team-by-date matrix for the selected range: opponent on game days, blank on off-days. */
function ScheduleGrid() {
  const { data, selected } = useApp();
  const gamesIn = useGamesInWindow();
  const byTeam = useRosterByTeam();
  const [sort, setSort] = useState<SortState>({ key: 'team', dir: 'asc' });
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const rows = sortTeamRows(
    data.teams.map((t) => ({ team: t.id, values: { games: gamesIn(t.id, selected) } })),
    sort,
    ['games'],
  );
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
        <h2>Schedule grid</h2>
        <span className="small muted">
          {selected.name}, {formatShort(selected.start)} – {formatShort(selected.end)}. Opponent shown on game days; “@” means away.
        </span>
      </div>
      <div className="grid-wrap">
        <table className="sgrid" onMouseLeave={() => setHoverCol(null)}>
          <thead>
            <tr>
              {head('team', 'Team', 'sticky')}
              {selected.dates.map((d, i) => (
                <th
                  key={d}
                  className={`dcol ${weekday(d) === 'Mon' && i > 0 ? 'wk' : ''} ${hoverCol === i ? 'col-hl' : ''}`}
                  title={`${weekday(d)} ${formatShort(d)} · ${data.schedule.gamesOn(d).length} NHL games`}
                  onMouseEnter={() => setHoverCol(i)}
                >
                  {weekday(d)}
                  <br />
                  {formatShort(d).replace(' ', ' ')}
                </th>
              ))}
              {head('games', 'Games', 'n')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.team}>
                <th className="sticky" scope="row" title={data.teams.find((t) => t.id === r.team)?.name}>
                  {r.team} {byTeam.get(r.team)?.length ? <span className="mine-dot" title="You have players on this team" /> : null}
                </th>
                {selected.dates.map((d, i) => {
                  const c = gridCell(data.schedule, r.team, d);
                  return (
                    <td
                      key={d}
                      className={`${c ? 'game' : 'off'} ${weekday(d) === 'Mon' && i > 0 ? 'wk' : ''} ${hoverCol === i ? 'col-hl' : ''}`}
                      title={c ? `${formatShort(d)}: ${c.home ? 'vs' : 'at'} ${c.opponent}` : `${formatShort(d)}: no game`}
                      onMouseEnter={() => setHoverCol(i)}
                    >
                      {c?.label ?? ''}
                    </td>
                  );
                })}
                <td className="n">{r.values.games}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
