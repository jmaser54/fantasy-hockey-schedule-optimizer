import { Fragment, useMemo, useState } from 'react';
import { formatShort, weekday } from '../domain/dates.ts';
import { isLightNight, rankTeams } from '../domain/rankings.ts';
import { opponent } from '../domain/schedule.ts';
import { useApp } from './context.ts';

type SortKey = { kind: 'window'; id: string } | { kind: 'light' } | { kind: 'team' };

export function RankingsView() {
  const { data, windows, selected, state, resolve } = useApp();
  const [sort, setSort] = useState<SortKey | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const teamIds = useMemo(() => data.teams.map((t) => t.id), [data.teams]);

  // Columns: each round, the full playoffs, and the custom range when it is selected.
  const cols = windows.filter((w) => w.id !== 'custom' || selected.id === 'custom');
  const rankings = useMemo(() => rankTeams(data.schedule, teamIds, cols.map((w) => ({ start: w.start, end: w.end }))), [data.schedule, teamIds, cols]);
  // Light-night games over exactly the selected dates (for "Full playoffs", the union of the rounds).
  const light = useMemo(
    () => rankTeams(data.schedule, teamIds, selected.id === 'all' ? state.periods : [{ start: selected.start, end: selected.end }]),
    [data.schedule, teamIds, selected, state.periods],
  );
  const lightBy = new Map(light.map((r) => [r.team, r.lightNight]));
  // "Full playoffs" spans the rounds' dates only; count its games over those dates.
  const fullIdx = cols.findIndex((w) => w.id === 'all');
  const allWindow = cols[fullIdx];
  const games = (teamIdx: number, colIdx: number) => {
    const r = rankings[teamIdx]!;
    if (colIdx === fullIdx && allWindow) {
      const dates = new Set(allWindow.dates);
      return data.schedule.teamGames(r.team, allWindow.start, allWindow.end).filter((g) => dates.has(g.date)).length;
    }
    return r.byPeriod[colIdx]!;
  };

  const mine = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of state.roster) {
      const p = resolve(e.playerId);
      if (p) m.set(p.team, (m.get(p.team) ?? 0) + 1);
    }
    return m;
  }, [state.roster, resolve]);

  const activeSort: SortKey = sort ?? { kind: 'window', id: cols.some((c) => c.id === selected.id) ? selected.id : cols[0]!.id };
  const rows = rankings.map((r, i) => ({
    team: r.team,
    values: cols.map((_, ci) => games(i, ci)),
    light: lightBy.get(r.team) ?? 0,
  }));
  const ci = activeSort.kind === 'window' ? cols.findIndex((c) => c.id === activeSort.id) : -1;
  rows.sort((a, b) => {
    if (activeSort.kind === 'team') return a.team.localeCompare(b.team);
    const av = activeSort.kind === 'light' ? a.light : a.values[ci]!;
    const bv = activeSort.kind === 'light' ? b.light : b.values[ci]!;
    return bv - av || (activeSort.kind === 'light' ? b.values[ci]! - a.values[ci]! : b.light - a.light) || a.team.localeCompare(b.team);
  });

  // League-wide games per night in the selected window.
  const nights = selected.dates.map((d) => ({ d, n: data.schedule.gamesOn(d).length }));
  const maxNight = Math.max(1, ...nights.map((x) => x.n));
  const lightCount = nights.filter((x) => isLightNight(x.n, data.teams.length)).length;

  const sortTh = (key: SortKey, label: string, title?: string, extra = '') => {
    const isActive = JSON.stringify(key) === JSON.stringify(activeSort);
    return (
      <th className={`sortable n ${extra} ${isActive ? 'active' : ''}`} title={title} onClick={() => setSort(key)} aria-sort={isActive ? 'descending' : 'none'}>
        {label}
        {isActive ? ' ↓' : ''}
      </th>
    );
  };

  return (
    <div className="stack">
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
              <div key={d} className="bar-col" title={`${weekday(d)} ${formatShort(d)}: ${n} games`}>
                <div className={`bar ${isLightNight(n, data.teams.length) ? 'light' : ''}`} style={{ height: `${(n / maxNight) * 44}px` }} />
                <span className="lbl">{d.slice(8).replace(/^0/, '')}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>NHL team schedules</h2>
          <span className="small muted">Games each team plays in each window. Click a team for its dates.</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="n">#</th>
                <th className="sortable" onClick={() => setSort({ kind: 'team' })}>
                  Team
                </th>
                {cols.map((w) => (
                  <Fragment key={w.id}>{sortTh({ kind: 'window', id: w.id }, w.name, `${formatShort(w.start)} – ${formatShort(w.end)}`, w.id === selected.id ? 'col-selected' : '')}</Fragment>
                ))}
                {sortTh({ kind: 'light' }, `Light-night games`, `Games on nights with 8 or fewer NHL games, in ${selected.name}. Those games compete with fewer of your other players for lineup spots.`)}
                <th className="n" title="Players on your roster from this team">
                  Your players
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <Fragment key={r.team}>
                  <tr onClick={() => setExpanded(expanded === r.team ? null : r.team)} style={{ cursor: 'pointer' }}>
                    <td className="n muted">{idx + 1}</td>
                    <td>
                      <div className="team-cell">
                        <span className="team-abbr">{r.team}</span>
                        <span className="muted small">{data.teams.find((t) => t.id === r.team)?.name}</span>
                      </div>
                    </td>
                    {r.values.map((v, i) => (
                      <td key={cols[i]!.id} className={`n ${cols[i]!.id === selected.id ? 'col-selected' : ''}`}>
                        {v}
                      </td>
                    ))}
                    <td className="n">{r.light}</td>
                    <td className="n">{mine.get(r.team) ? <><span className="mine-dot" /> {mine.get(r.team)}</> : ''}</td>
                  </tr>
                  {expanded === r.team && (
                    <tr className="expand-row">
                      <td />
                      <td colSpan={cols.length + 3}>
                        <TeamGames team={r.team} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
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
