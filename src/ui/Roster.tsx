import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { formatRange } from '../domain/dates.ts';
import { playerGames } from '../domain/schedule.ts';
import { extractRosterNames, type MatchResult } from '../domain/rosterImport.ts';
import { describeIssue, effectivePositions, validateRoster } from '../domain/roster.ts';
import type { Player, Position, RosterEntry } from '../domain/types.ts';
import { useApp } from './context.ts';
import { PlayerSearch, PosBadges, PosToggles, PreferredToggle, usePlayerIndex } from './common.tsx';

interface ReviewLine {
  raw: string;
  name: string;
  teamHint?: string;
  result: MatchResult;
  /** Chosen player id, or null to skip. */
  choice: string | null;
}

/** What one Add Players action did, shown until dismissed. Only `review` needs the user. */
interface ImportOutcome {
  added: number;
  alreadyOnRoster: number;
  review: ReviewLine[];
  unrecognized: string[];
  ignored: number;
}

type InputMode = 'paste' | 'image' | 'search';
const INPUT_MODES: { id: InputMode; label: string }[] = [
  { id: 'paste', label: 'Paste Roster' },
  { id: 'image', label: 'Upload Image' },
  { id: 'search', label: 'Search Players' },
];

export function RosterView({ onGoLineup }: { onGoLineup: () => void }) {
  const { state, dispatch, resolve, toast, setupLine } = useApp();
  const [mode, setMode] = useState<InputMode>('paste');
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const { data } = useApp();
  const index = usePlayerIndex();
  const teamIds = useMemo(() => new Set(data.teams.map((t) => t.id)), [data.teams]);
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

  /**
   * One Add Players action, for pasted text and screenshot text alike: exact, unambiguous players are
   * added at once; players already on the roster are skipped; only same-name or near matches wait
   * for the user; obvious non-player text is dropped.
   */
  const importText = (text: string): ImportOutcome => {
    const r = extractRosterNames(text, index, teamIds);
    const fresh = r.matched.filter((p) => !onRoster.has(p.id));
    if (fresh.length) dispatch({ type: 'addPlayers', ids: fresh.map((p) => p.id) });
    // A name whose candidate is already on the roster needs no decision: count it, don't ask.
    const settled = (x: (typeof r.review)[number]) =>
      x.preselect ? onRoster.has(x.preselect) : x.result.status === 'ambiguous' && x.result.candidates.some((c) => onRoster.has(c.id));
    const open = r.review.filter((x) => !settled(x));
    const result: ImportOutcome = {
      added: fresh.length,
      alreadyOnRoster: r.matched.length - fresh.length + (r.review.length - open.length),
      review: open.map((x) => ({ raw: x.raw, name: x.name, teamHint: x.teamHint, result: x.result, choice: x.preselect ?? null })),
      unrecognized: r.unrecognized,
      ignored: r.ignored,
    };
    if (fresh.length) toast(`Added ${fresh.length} player${fresh.length === 1 ? '' : 's'}`);
    setOutcome(result);
    return result;
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
        <div className="panel-body stack roster-body">
          {setupLine && <div className="roster-setup">{setupLine}</div>}
          <div className="mode-switch modes-3" role="tablist" aria-label="Add players">
            {INPUT_MODES.map((m) => (
              <button key={m.id} role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)}>
                {/* One word per line, so all three labels are two lines; the space keeps the accessible name. */}
                {m.label.split(' ').map((w, i) => (
                  <Fragment key={i}>
                    {i > 0 && ' '}
                    <span className="mode-word">{w}</span>
                  </Fragment>
                ))}
              </button>
            ))}
          </div>
          {state.roster.length > 0 && (
            <div className="clear-roster-row">
              <ClearRosterButton />
            </div>
          )}
          {mode === 'search' && (
            <div className="add-bar">
              <PlayerSearch onPick={add} exclude={onRoster} placeholder="Add a player by name…" />
            </div>
          )}
          {mode === 'paste' && <PasteBox onImport={importText} />}
          {mode === 'image' && <ImageBox onImport={importText} />}
          {outcome && mode !== 'search' && (
            <ImportReview
              outcome={outcome}
              onChange={(review) => setOutcome({ ...outcome, review })}
              onDone={(ids) => {
                if (ids.length) {
                  dispatch({ type: 'addPlayers', ids });
                  toast(`Added ${ids.length} player${ids.length === 1 ? '' : 's'}`);
                }
                setOutcome(null);
              }}
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

/** No autofocus: focusing on mount made phones zoom or jump when switching modes (owner report, 2026-11-21). */
function PasteBox({ onImport }: { onImport: (text: string) => ImportOutcome }) {
  const [text, setText] = useState('');
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="paste-hint">Paste your roster page - player names detected automatically</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Connor McDavid\nQuinn Hughes, VAN\nIgor Shesterkin\n…'}
        aria-label="Paste player names"
      />
      <div>
        <button
          className="btn primary"
          disabled={!text.trim()}
          onClick={() => {
            const r = onImport(text);
            if (r.added || r.alreadyOnRoster || r.review.length) setText('');
          }}
        >
          Add Players
        </button>
      </div>
    </div>
  );
}

interface Shot {
  id: number;
  file: File;
  status: 'reading' | 'done' | 'error';
  text?: string;
  ms?: number;
}

/**
 * Upload Image: one or more roster screenshots from any fantasy site or app, added at once or a few at
 * a time. Each is read on the device as soon as it is added; Add Players then imports the names found
 * in all of them together (duplicates across screenshots count once).
 */
function ImageBox({ onImport }: { onImport: (text: string) => ImportOutcome }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  useEffect(() => {
    // Start fetching the reader as soon as this panel opens, so the first screenshot is read sooner.
    import('./ocr.ts').then((m) => m.warmUpOcr()).catch(() => {});
  }, []);
  const addFiles = (files: FileList | null) => {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    const added = list.map((file) => ({ id: nextId.current++, file, status: 'reading' as const }));
    setShots((s) => [...s, ...added]);
    for (const shot of added) {
      const t0 = performance.now();
      import('./ocr.ts')
        .then((m) => m.readScreenshot(shot.file))
        .then((text) => setShots((s) => s.map((x) => (x.id === shot.id ? { ...x, status: 'done', text, ms: Math.round(performance.now() - t0) } : x))))
        .catch(() => setShots((s) => s.map((x) => (x.id === shot.id ? { ...x, status: 'error' } : x))));
    }
  };
  const reading = shots.filter((s) => s.status === 'reading').length;
  const ready = shots.filter((s) => s.status === 'done');
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label="Choose roster screenshots"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {shots.length > 0 && (
        <ul className="shots">
          {shots.map((s) => (
            <li key={s.id}>
              <span className="shot-name" title={s.file.name}>
                {s.file.name}
              </span>
              <span className={`small ${s.status === 'error' ? 'bad-text' : 'muted'}`}>
                {s.status === 'reading' ? 'Reading…' : s.status === 'error' ? 'Couldn’t read this image' : 'Ready'}
              </span>
              <button className="icon-btn" aria-label={`Remove ${s.file.name}`} title="Remove" onClick={() => setShots((x) => x.filter((y) => y.id !== s.id))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row-actions shot-actions">
        <button className="btn" onClick={() => input.current?.click()} title="Screenshots are read on your device and never uploaded">
          {shots.length ? 'Add More Screenshots' : 'Choose Screenshots'}
        </button>
        <button
          className="btn primary"
          disabled={!ready.length || reading > 0}
          onClick={() => {
            const r = onImport(ready.map((s) => s.text).join('\n'));
            if (r.added || r.alreadyOnRoster || r.review.length) setShots([]);
          }}
        >
          {reading ? `Reading ${reading} screenshot${reading === 1 ? '' : 's'}…` : 'Add Players'}
        </button>
      </div>
    </div>
  );
}

/**
 * The result of an Add Players action. Exact matches were already added; only same-name players and
 * near matches are listed for a decision. Name-like text that matched nobody is tucked away under
 * "Not recognized", where it can still be added as a new player.
 */
function ImportReview(props: {
  outcome: ImportOutcome;
  onChange: (l: ReviewLine[]) => void;
  onDone: (ids: string[]) => void;
  onRoster: ReadonlySet<string>;
}) {
  const { teams, dispatch, toast } = useApp();
  const [creating, setCreating] = useState<string | null>(null);
  const lines = props.outcome.review;
  const set = (i: number, choice: string | null) => props.onChange(lines.map((l, k) => (k === i ? { ...l, choice } : l)));
  const chosen = [...new Set(lines.map((l) => l.choice).filter((c): c is string => !!c && !props.onRoster.has(c)))];
  const o = props.outcome;
  const summary = [
    o.added ? `${o.added} added` : '',
    o.alreadyOnRoster ? `${o.alreadyOnRoster} already on your roster` : '',
    lines.length ? `${lines.length} need${lines.length === 1 ? 's' : ''} a look` : '',
  ].filter(Boolean);
  const createForm = (key: string, name: string, teamHint?: string, onCreated?: (p: Player) => void) =>
    creating === key && (
      <div style={{ gridColumn: '2 / -1' }}>
        <CustomPlayerForm
          initialName={name}
          initialTeam={teamHint}
          teams={[...teams.values()]}
          onCreate={(p) => {
            dispatch({ type: 'addCustomPlayer', player: p });
            if (onCreated) onCreated(p);
            else {
              dispatch({ type: 'addPlayers', ids: [p.id] });
              toast(`Added ${p.name}`);
            }
            setCreating(null);
          }}
        />
      </div>
    );
  return (
    <div className="panel import-result" style={{ boxShadow: 'none' }}>
      <div className="panel-head">
        <h2>{summary.length ? summary.join(' · ') : 'No players found'}</h2>
        {lines.length > 0 ? (
          <>
            <button className="btn ghost" onClick={() => props.onDone([])}>
              Skip
            </button>
            <button className="btn primary" disabled={chosen.length === 0} onClick={() => props.onDone(chosen)}>
              Add {chosen.length} Player{chosen.length === 1 ? '' : 's'}
            </button>
          </>
        ) : (
          <button className="btn ghost" onClick={() => props.onDone([])}>
            Done
          </button>
        )}
      </div>
      {lines.length > 0 && (
        <div className="panel-body review">
          {lines.map((l, i) => {
            const r = l.result;
            const candidates = r.status === 'ambiguous' || r.status === 'suggested' ? r.candidates : r.status === 'matched' ? [r.player] : [];
            return (
              <div key={i} className="review-row">
                <span>{l.choice ? <span className="ok">✓</span> : '?'}</span>
                <span className="raw" title={l.raw}>
                  {l.name}
                </span>
                <span className="opts">
                  {r.status === 'ambiguous' && <span className="small muted">Which one?</span>}
                  {r.status === 'suggested' && <span className="small muted">Did you mean</span>}
                  {candidates.map((c) => (
                    <button key={c.id} className="opt" aria-pressed={l.choice === c.id} onClick={() => set(i, l.choice === c.id ? null : c.id)}>
                      {c.name} · {c.team} · {c.positions.join('/')}
                      {props.onRoster.has(c.id) ? ' (on roster)' : ''}
                    </button>
                  ))}
                  {r.status !== 'matched' && (
                    <button className="opt" onClick={() => setCreating(creating === `r${i}` ? null : `r${i}`)}>
                      Add as New Player…
                    </button>
                  )}
                </span>
                {createForm(`r${i}`, l.name, l.teamHint, (p) =>
                  props.onChange(lines.map((x, k) => (k === i ? { ...x, choice: p.id, result: { status: 'matched', player: p } } : x))),
                )}
              </div>
            );
          })}
        </div>
      )}
      {(o.unrecognized.length > 0 || o.ignored > 0) && (
        <details className="import-extra">
          <summary className="small muted">
            {o.unrecognized.length ? `${o.unrecognized.length} name${o.unrecognized.length === 1 ? '' : 's'} not recognized · ` : ''}
            {o.ignored} line{o.ignored === 1 ? '' : 's'} of other text ignored
          </summary>
          {o.unrecognized.length > 0 && (
            <div className="review">
              {o.unrecognized.map((n) => (
                <div key={n} className="review-row">
                  <span>✕</span>
                  <span className="raw">{n}</span>
                  <span className="opts">
                    <button className="opt" onClick={() => setCreating(creating === `u${n}` ? null : `u${n}`)}>
                      Add as New Player…
                    </button>
                  </span>
                  {createForm(`u${n}`, n)}
                </div>
              ))}
            </div>
          )}
        </details>
      )}
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
  const { state, dispatch, resolve, weekWindow: week, data, teams } = useApp();
  const rows = state.roster.map((e) => ({ e, p: resolve(e.playerId) }));
  const order = (r: { e: RosterEntry; p?: Player }) => (r.e.onIr ? 2 : r.p && effectivePositions(r.e, r.p).every((x) => x === 'G') ? 1 : 0);
  rows.sort((a, b) => order(a) - order(b));
  // Roster has no period toggle: games are always for next week.
  const dates = new Set(week.dates);
  return (
    <section className="panel">
      <div className="table-wrap">
        <table className="roster-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Team</th>
              <th title="Fantasy positions this player can fill">Eligible</th>
              <th className="n" title={`NHL games next week (${formatRange(week.start, week.end)})`}>
                Games next week
              </th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, p }) => {
              if (!p) {
                return (
                  <tr key={e.playerId} className="missing">
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
              const games = playerGames(data.schedule, p, week.start, week.end).filter((g) => dates.has(g.date)).length;
              return (
                <tr key={e.playerId}>
                  <td className="r-name">
                    <PreferredToggle id={e.playerId} name={p.name} preferred={!!e.preferred} /> {p.name}
                    {p.stints && p.stints.length > 1 && (
                      <span className="badge" title={p.stints.map((s) => `${s.team}${s.from ? ` from ${s.from}` : ''}${s.to ? ` to ${s.to}` : ''}`).join('; ')}>
                        Traded
                      </span>
                    )}
                  </td>
                  <td className="r-team" title={teams.get(p.team)?.name}>{p.team}</td>
                  <td className="r-elig">
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
                  <td className="n r-games">{games}</td>
                  <td className="r-status">
                    <select
                      value={e.onIr ? 'ir' : 'active'}
                      aria-label={`${p.name} status`}
                      onChange={(ev) => dispatch({ type: 'updateEntry', id: e.playerId, patch: { onIr: ev.target.value === 'ir' } })}
                    >
                      <option value="active">Active</option>
                      <option value="ir">IR</option>
                    </select>
                  </td>
                  <td className="r-remove">
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
        <PosBadges positions={['C', 'LW', 'RW', 'D', 'G']} /> toggles change eligibility for your league. ★ Starred players get priority in automatically optimized lineups. Manual lineup changes take precedence. IR players don’t count toward the roster limit and never play.
      </div>
    </section>
  );
}

/**
 * Clear Roster: red text on a white background with a subtle red outline (always visible), on its own
 * row directly under the Paste Roster / Search Players toggle, aligned left (owner request,
 * 2026-11-21). Separate from the toggle and shown in both modes. Same confirmation and clearRoster
 * action as before.
 */
function ClearRosterButton() {
  const { state, dispatch, toast } = useApp();
  if (state.roster.length === 0) return null;
  return (
    <button
      type="button"
      className="clear-roster-btn"
      onClick={() => {
        if (confirm(`Remove all ${state.roster.length} players from your roster? This can’t be undone. Your league settings are kept.`)) {
          dispatch({ type: 'clearRoster' });
          toast('Roster cleared');
        }
      }}
    >
      Clear Roster
    </button>
  );
}

function sameSet(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}
