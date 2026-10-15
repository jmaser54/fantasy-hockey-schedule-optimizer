import { useMemo, useState } from 'react';
import { playerGames } from '../domain/schedule.ts';
import { matchName, parseRosterText, type MatchResult } from '../domain/rosterImport.ts';
import { describeIssue, effectivePositions, validateRoster } from '../domain/roster.ts';
import type { Player, Position, RosterEntry } from '../domain/types.ts';
import { useApp } from './context.ts';
import { PlayerSearch, PosBadges, PosToggles, PreferredToggle, isInactive, usePlayerIndex } from './common.tsx';

interface ReviewLine {
  raw: string;
  name: string;
  teamHint?: string;
  result: MatchResult;
  /** Chosen player id, or null to skip. */
  choice: string | null;
}

export function RosterView({ onGoLineup }: { onGoLineup: () => void }) {
  const { state, dispatch, resolve, toast } = useApp();
  const [mode, setMode] = useState<'paste' | 'search'>('paste');
  const [review, setReview] = useState<ReviewLine[] | null>(null);
  const onRoster = useMemo(() => new Set(state.roster.map((e) => e.playerId)), [state.roster]);

  const playersMap = useMemo(() => {
    const m = new Map<string, Player>();
    for (const e of state.roster) {
      const p = resolve(e.playerId);
      if (p) m.set(e.playerId, p);
    }
    return m;
  }, [state.roster, resolve]);
  const issues = validateRoster(state.roster, playersMap, state.league);
  const active = state.roster.filter((e) => !e.onIr).length;
  const ir = state.roster.length - active;

  const add = (p: Player) => {
    if (onRoster.has(p.id)) return toast(`${p.name} is already on your roster`);
    dispatch({ type: 'addPlayers', ids: [p.id] });
    toast(`Added ${p.name}`);
  };

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Roster</h2>
          <span className="counts">
            <span>
              Roster <b className={active > state.league.rosterSize ? 'over' : ''}>{active}</b>/{state.league.rosterSize}
            </span>
            <span>
              IR <b className={ir > state.league.irSlots ? 'over' : ''}>{ir}</b>/{state.league.irSlots}
            </span>
          </span>
          {state.roster.length > 0 && (
            <button className="btn small" onClick={onGoLineup}>
              View Lineup →
            </button>
          )}
        </div>
        <div className="panel-body stack">
          <div className="mode-switch" role="tablist" aria-label="Add players">
            <button role="tab" aria-selected={mode === 'paste'} onClick={() => setMode('paste')}>
              Paste Roster
            </button>
            <button role="tab" aria-selected={mode === 'search'} onClick={() => setMode('search')}>
              Search Players
            </button>
          </div>
          {mode === 'search' && (
            <div className="add-bar">
              <PlayerSearch onPick={add} exclude={onRoster} autoFocus placeholder="Add a player by name…" />
            </div>
          )}
          {mode === 'paste' && !review && <PasteBox onParsed={setReview} autoFocus={state.roster.length === 0} />}
          {mode === 'paste' && review && (
            <ImportReview
              lines={review}
              onChange={setReview}
              onDone={(ids) => {
                dispatch({ type: 'addPlayers', ids });
                setReview(null);
                toast(`Added ${ids.length} player${ids.length === 1 ? '' : 's'}`);
              }}
              onCancel={() => setReview(null)}
              onRoster={onRoster}
            />
          )}
          {issues.length > 0 && (
            <div className="notice" role="alert">
              <b>Roster doesn’t fit your league settings</b>
              <ul>
                {issues.map((i, k) => (
                  <li key={k}>{describeIssue(i)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {state.roster.length === 0 ? (
        <div className="panel empty">
          <strong>No Players Yet</strong>
          Search above, or paste your whole roster from your league site.
        </div>
      ) : (
        <RosterTable />
      )}
    </div>
  );
}

function PasteBox({ onParsed, autoFocus }: { onParsed: (lines: ReviewLine[]) => void; autoFocus?: boolean }) {
  const { data } = useApp();
  const index = usePlayerIndex();
  const [text, setText] = useState('');
  const teamIds = useMemo(() => new Set(data.teams.map((t) => t.id)), [data.teams]);
  const parse = () => {
    const parsed = parseRosterText(text, teamIds);
    onParsed(
      parsed.map((l) => {
        const result = matchName(l.name, index, l.teamHint);
        return { ...l, result, choice: result.status === 'matched' ? result.player.id : null };
      }),
    );
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="paste-hint">Paste your fantasy roster below to automatically identify the player names.</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Connor McDavid\nQuinn Hughes, VAN\nIgor Shesterkin\n…'}
        aria-label="Paste player names"
        autoFocus={autoFocus}
      />
      <div>
        <button className="btn primary" disabled={!text.trim()} onClick={parse}>
          Match Names
        </button>
      </div>
    </div>
  );
}

function ImportReview(props: {
  lines: ReviewLine[];
  onChange: (l: ReviewLine[]) => void;
  onDone: (ids: string[]) => void;
  onCancel: () => void;
  onRoster: ReadonlySet<string>;
}) {
  const { teams, dispatch } = useApp();
  const [creating, setCreating] = useState<number | null>(null);
  const set = (i: number, choice: string | null) => props.onChange(props.lines.map((l, k) => (k === i ? { ...l, choice } : l)));
  const chosen = [...new Set(props.lines.map((l) => l.choice).filter((c): c is string => !!c && !props.onRoster.has(c)))];
  const counts = {
    matched: props.lines.filter((l) => l.result.status === 'matched').length,
    review: props.lines.filter((l) => l.result.status !== 'matched').length,
  };
  return (
    <div className="panel" style={{ boxShadow: 'none' }}>
      <div className="panel-head">
        <h2>
          {counts.matched} matched{counts.review ? ` · ${counts.review} need a look` : ''}
        </h2>
        <button className="btn ghost" onClick={props.onCancel}>
          Back
        </button>
        <button className="btn primary" disabled={chosen.length === 0} onClick={() => props.onDone(chosen)}>
          Add {chosen.length} Player{chosen.length === 1 ? '' : 's'}
        </button>
      </div>
      <div className="panel-body review">
        {props.lines.map((l, i) => {
          const r = l.result;
          const candidates = r.status === 'ambiguous' || r.status === 'suggested' ? r.candidates : r.status === 'matched' ? [r.player] : [];
          return (
            <div key={i} className="review-row">
              <span>{l.choice ? <span className="ok">✓</span> : r.status === 'unmatched' ? '✕' : '?'}</span>
              <span className="raw" title={l.raw}>
                {l.name}
              </span>
              <span className="opts">
                {r.status === 'ambiguous' && <span className="small muted">Which one?</span>}
                {r.status === 'suggested' && <span className="small muted">Did you mean</span>}
                {r.status === 'unmatched' && <span className="small muted">No match</span>}
                {candidates.map((c) => (
                  <button key={c.id} className="opt" aria-pressed={l.choice === c.id} onClick={() => set(i, l.choice === c.id ? null : c.id)}>
                    {c.name} · {c.team} · {c.positions.join('/')}
                    {isInactive(c) ? ' · not on NHL roster' : ''}
                    {props.onRoster.has(c.id) ? ' (on roster)' : ''}
                  </button>
                ))}
                {r.status !== 'matched' && (
                  <button className="opt" onClick={() => setCreating(creating === i ? null : i)}>
                    Add as New Player…
                  </button>
                )}
              </span>
              {creating === i && (
                <div style={{ gridColumn: '2 / -1' }}>
                  <CustomPlayerForm
                    initialName={l.name}
                    initialTeam={l.teamHint}
                    teams={[...teams.values()]}
                    onCreate={(p) => {
                      dispatch({ type: 'addCustomPlayer', player: p });
                      props.onChange(props.lines.map((x, k) => (k === i ? { ...x, choice: p.id, result: { status: 'matched', player: p } } : x)));
                      setCreating(null);
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CustomPlayerForm(props: { initialName: string; initialTeam?: string; teams: { id: string; name: string }[]; onCreate: (p: Player) => void }) {
  const [name, setName] = useState(props.initialName);
  const [team, setTeam] = useState(props.initialTeam ?? '');
  const [positions, setPositions] = useState<Position[]>([]);
  const ok = name.trim() && team && positions.length > 0;
  return (
    <div className="form-row" style={{ alignItems: 'end', padding: '8px 0' }}>
      <div className="field">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>NHL Team</label>
        <select value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">Choose…</option>
          {props.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Eligible Positions</label>
        <PosToggles value={positions} onChange={setPositions} />
      </div>
      <div>
        <button
          className="btn primary small"
          disabled={!ok}
          onClick={() => props.onCreate({ id: `custom-${Date.now().toString(36)}`, name: name.trim(), team, positions, eligibilitySource: 'user' })}
        >
          Create
        </button>
      </div>
    </div>
  );
}

function RosterTable() {
  const { state, dispatch, resolve, selected, data, teams, toast } = useApp();
  const rows = state.roster.map((e) => ({ e, p: resolve(e.playerId) }));
  const order = (r: { e: RosterEntry; p?: Player }) => (r.e.onIr ? 2 : r.p && effectivePositions(r.e, r.p).every((x) => x === 'G') ? 1 : 0);
  rows.sort((a, b) => order(a) - order(b));
  const dates = new Set(selected.dates);
  return (
    <section className="panel">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Team</th>
              <th title="Fantasy positions this player can fill">Eligible</th>
              <th className="n" title={`NHL games in ${selected.name}`}>
                Games
              </th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, p }) => {
              if (!p) {
                return (
                  <tr key={e.playerId}>
                    <td colSpan={5}>
                      <span className="badge bad">Missing from Player Data</span> <span className="muted small">{e.playerId}</span>
                    </td>
                    <td>
                      <button className="icon-btn" onClick={() => dispatch({ type: 'removePlayer', id: e.playerId })} aria-label="Remove">
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              }
              const pos = effectivePositions(e, p);
              const games = playerGames(data.schedule, p, selected.start, selected.end).filter((g) => dates.has(g.date)).length;
              return (
                <tr key={e.playerId}>
                  <td>
                    <PreferredToggle id={e.playerId} name={p.name} preferred={!!e.preferred} /> {p.name}
                    {p.stints && p.stints.length > 1 && (
                      <span className="badge" title={p.stints.map((s) => `${s.team}${s.from ? ` from ${s.from}` : ''}${s.to ? ` to ${s.to}` : ''}`).join('; ')}>
                        Traded
                      </span>
                    )}
                  </td>
                  <td title={teams.get(p.team)?.name}>{p.team}</td>
                  <td>
                    <PosToggles
                      value={pos}
                      onChange={(v) => dispatch({ type: 'updateEntry', id: e.playerId, patch: { positionsOverride: sameSet(v, p.positions) ? undefined : v } })}
                    />{' '}
                    {e.positionsOverride ? (
                      <button className="btn ghost small" onClick={() => dispatch({ type: 'updateEntry', id: e.playerId, patch: { positionsOverride: undefined } })} title={`Data: ${p.positions.join('/')}`}>
                        reset
                      </button>
                    ) : p.eligibilitySource !== 'espn' ? (
                      // ESPN eligibility is the norm and isn't labeled; flag only the exceptions.
                      <span className="small muted" title={p.eligibilitySource === 'nhl' ? 'NHL listed position (no ESPN eligibility found)' : 'Entered by you'}>
                        {p.eligibilitySource === 'nhl' ? 'NHL' : 'you'}
                      </span>
                    ) : null}
                  </td>
                  <td className="n">{games}</td>
                  <td>
                    <select
                      value={e.onIr ? 'ir' : 'active'}
                      aria-label={`${p.name} status`}
                      onChange={(ev) => dispatch({ type: 'updateEntry', id: e.playerId, patch: { onIr: ev.target.value === 'ir' } })}
                    >
                      <option value="active">Active</option>
                      <option value="ir">IR</option>
                    </select>
                  </td>
                  <td>
                    <button className="icon-btn" onClick={() => dispatch({ type: 'removePlayer', id: e.playerId })} aria-label={`Remove ${p.name}`} title="Remove">
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel-body small muted" style={{ borderTop: '1px solid var(--border)' }}>
        <PosBadges positions={['C', 'LW', 'RW', 'D', 'G']} /> toggles change eligibility for your league. ★ marks preferred players, who get lineup spots first when more players have games than there are spots. IR players don’t count toward the roster limit and never play.
      </div>
      <div className="clear-roster">
        <button
          className="btn small"
          onClick={() => {
            if (confirm(`Remove all ${state.roster.length} players from your roster? This can’t be undone. Your league settings are kept.`)) {
              dispatch({ type: 'clearRoster' });
              toast('Roster cleared');
            }
          }}
        >
          Clear Roster
        </button>
      </div>
    </section>
  );
}

function sameSet(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}
