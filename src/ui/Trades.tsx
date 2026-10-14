import { useMemo } from 'react';
import { optimizeDates } from '../domain/optimizer.ts';
import { describeIssue, toLineupPlayers, validateRoster } from '../domain/roster.ts';
import type { Player } from '../domain/types.ts';
import { hasScenario, proposedRoster } from '../state/appState.ts';
import { useApp } from './context.ts';
import { Delta, PlayerSearch, PosBadges } from './common.tsx';

/**
 * Before/after comparison of optimal usable games. Both sides use the
 * optimizer's best daily lineups, so manual lineup edits don't skew it.
 */
export function TradesView({ onGoRoster }: { onGoRoster: () => void }) {
  const { state, dispatch, resolve, data, windows, selected, summarizeWindow, toast } = useApp();
  const scenario = state.scenario;
  const proposed = useMemo(() => proposedRoster(state), [state]);

  const allDates = useMemo(() => [...new Set(windows.flatMap((w) => w.dates))].sort(), [windows]);
  const mapFor = (entries: typeof proposed) => {
    const m = new Map<string, Player>();
    for (const e of entries) {
      const p = resolve(e.playerId);
      if (p) m.set(e.playerId, p);
    }
    return m;
  };
  const beforePlayers = useMemo(() => toLineupPlayers(state.roster, mapFor(state.roster)), [state.roster, resolve]);
  const afterPlayers = useMemo(() => toLineupPlayers(proposed, mapFor(proposed)), [proposed, resolve]);
  const beforeDays = useMemo(() => optimizeDates(allDates, beforePlayers, state.league, data.schedule), [allDates, beforePlayers, state.league, data.schedule]);
  const afterDays = useMemo(() => optimizeDates(allDates, afterPlayers, state.league, data.schedule), [allDates, afterPlayers, state.league, data.schedule]);

  if (state.roster.length === 0) {
    return (
      <div className="panel empty">
        <strong>Add your roster first</strong>
        Then try adding, dropping or swapping players here without changing it.
        <div style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={onGoRoster}>
            Add players
          </button>
        </div>
      </div>
    );
  }

  const shown = windows.filter((w) => w.id !== 'custom' || selected.id === 'custom');
  const rows = shown.map((w) => ({
    w,
    before: summarizeWindow(w, beforeDays, beforePlayers),
    after: summarizeWindow(w, afterDays, afterPlayers),
  }));
  const proposedIssues = validateRoster(proposed, mapFor(proposed), state.league);
  const onRoster = new Set(state.roster.map((e) => e.playerId));
  const exclude = new Set([...onRoster, ...scenario.adds]);
  const set = (next: typeof scenario) => dispatch({ type: 'scenario', scenario: next });
  const toggleDrop = (id: string) =>
    set({ ...scenario, drops: scenario.drops.includes(id) ? scenario.drops.filter((d) => d !== id) : [...scenario.drops, id] });

  const selRow = rows.find((r) => r.w.id === selected.id) ?? rows[0]!;
  const perPlayer = (id: string, which: 'before' | 'after') => (which === 'before' ? selRow.before : selRow.after).players.find((p) => p.playerId === id);

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Usable games: current vs proposed</h2>
          <button className="btn small" disabled={state.scenarioHistory.length === 0} onClick={() => dispatch({ type: 'scenarioUndo' })}>
            Undo
          </button>
          <button className="btn small" disabled={!hasScenario(scenario)} onClick={() => dispatch({ type: 'scenarioReset' })}>
            Back to current roster
          </button>
          <button
            className="btn small primary"
            disabled={!hasScenario(scenario)}
            onClick={() => {
              if (confirm('Replace your saved roster with the proposed one?')) {
                dispatch({ type: 'scenarioApply' });
                toast('Proposed roster saved');
              }
            }}
          >
            Make this my roster
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Window</th>
                <th className="n">Current</th>
                <th className="n">Proposed</th>
                <th className="n">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ w, before, after }) => (
                <tr key={w.id} className={w.id === selected.id ? 'col-selected' : ''} style={w.id === 'all' ? { fontWeight: 700 } : undefined}>
                  <td>{w.name}</td>
                  <td className="n">{before.usable}</td>
                  <td className="n">{after.usable}</td>
                  <td className="n">
                    <Delta value={after.usable - before.usable} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-body small muted" style={{ borderTop: '1px solid var(--border)' }}>
          Both columns use optimal daily lineups. This compares schedule opportunity only, not player quality.
        </div>
      </section>

      {proposedIssues.length > 0 && (
        <div className="notice">
          <b>The proposed roster doesn’t fit your league settings</b>
          <ul>
            {proposedIssues.map((i, k) => (
              <li key={k}>{describeIssue(i)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="trade-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Drop</h2>
            <span className="small muted">Usable in {selected.name}</span>
          </div>
          <div className="panel-body">
            {state.roster.map((e) => {
              const p = resolve(e.playerId);
              const dropped = scenario.drops.includes(e.playerId);
              const b = perPlayer(e.playerId, 'before');
              return (
                <label key={e.playerId} className={`check-row ${dropped ? 'dropped' : ''}`}>
                  <input type="checkbox" checked={dropped} onChange={() => toggleDrop(e.playerId)} />
                  <span className="name">
                    {p?.name ?? e.playerId} {p && <PosBadges positions={p.positions} />} <span className="small muted">{p?.team}</span>
                    {e.onIr && <span className="badge">IR</span>}
                  </span>
                  <span className="small num muted">
                    {b ? `${b.usable}/${b.scheduled}` : ''}
                  </span>
                </label>
              );
            })}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Add</h2>
            <span className="small muted">Usable in {selected.name}</span>
          </div>
          <div className="panel-body stack" style={{ gap: 8 }}>
            <PlayerSearch exclude={exclude} placeholder="Find a player to add…" onPick={(p) => set({ ...scenario, adds: [...scenario.adds, p.id] })} />
            {scenario.adds.length === 0 && <div className="small muted">No players added.</div>}
            {scenario.adds.map((id) => {
              const p = resolve(id);
              const a = perPlayer(id, 'after');
              return (
                <div key={id} className="check-row">
                  <span className="name">
                    {p?.name ?? id} {p && <PosBadges positions={p.positions} />} <span className="small muted">{p?.team}</span>
                  </span>
                  <span className="small num muted">{a ? `${a.usable}/${a.scheduled}` : ''}</span>
                  <button className="icon-btn" aria-label={`Remove ${p?.name ?? id}`} onClick={() => set({ ...scenario, adds: scenario.adds.filter((x) => x !== id) })}>
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
