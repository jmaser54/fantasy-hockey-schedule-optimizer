import { useEffect, useState, type MutableRefObject } from 'react';
import { DEFAULT_LEAGUE, DEFAULT_PERIODS, validateLeague, validatePeriod } from '../domain/league.ts';
import type { LeagueConfig, Period } from '../domain/types.ts';
import { useApp } from './context.ts';
import { PosToggles } from './common.tsx';

/** Asks before leaving the page with unsaved edits: true when it's fine to leave. */
export type LeaveGuard = MutableRefObject<(() => boolean) | null>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * League Settings as a page in My Team (2026-11-26; it was a dialog from the top bar). The same form,
 * validation and explicit Save; "Discard changes" restores the saved values. Leaving with unsaved edits
 * (another tab or area, a link, a reload) asks first; staying keeps the edits.
 */
export function LeagueSettingsPage({ leaveGuard }: { leaveGuard: LeaveGuard }) {
  const { state, dispatch, toast } = useApp();
  const [league, setLeague] = useState<LeagueConfig>(() => structuredClone(state.league));
  const [periods, setPeriods] = useState<Period[]>(() => structuredClone(state.periods));
  // The saved values the draft started from: edits are anything that differs from these.
  const [base, setBase] = useState(() => ({ league: state.league, periods: state.periods }));
  const dirty = !same(league, base.league) || !same(periods, base.periods);
  // Saved settings changed elsewhere (another browser tab) while nothing is edited here: show them.
  useEffect(() => {
    if (dirty || (same(state.league, base.league) && same(state.periods, base.periods))) return;
    setLeague(structuredClone(state.league));
    setPeriods(structuredClone(state.periods));
    setBase({ league: state.league, periods: state.periods });
  }, [state.league, state.periods]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    leaveGuard.current = () => !dirty || globalThis.confirm('Discard your unsaved league settings changes?');
    return () => {
      leaveGuard.current = null;
    };
  }, [dirty, leaveGuard]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);
  // Blank fields may be saved (a new user can change playoff rounds first); invalid values may not.
  const leagueErrors = validateLeague(league, { allowBlank: true });
  const filledActive = league.slots.reduce((n, s) => n + (Number.isNaN(s.count) ? 0 : s.count), 0);
  const periodErrors = periods.map(validatePeriod);
  const hasErrors = leagueErrors.length > 0 || periodErrors.some(Boolean) || periods.length === 0;

  const save = () => {
    dispatch({ type: 'setLeague', league });
    dispatch({ type: 'setPeriods', periods });
    setBase({ league, periods });
    toast('Settings saved');
  };
  const discard = () => {
    setLeague(structuredClone(base.league));
    setPeriods(structuredClone(base.periods));
  };
  const num = (v: string) => (v === '' ? NaN : Math.floor(Number(v)));
  const updSlot = (i: number, patch: Partial<LeagueConfig['slots'][number]>) =>
    setLeague({ ...league, slots: league.slots.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const updPeriod = (i: number, patch: Partial<Period>) => setPeriods(periods.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  return (
    <div className="stack">
      <section className="panel settings-page" aria-label="League Settings">
        <div className="panel-head">
          <h2>League Settings</h2>
        </div>
        <div className="panel-body">
          <div className="form-row">
            <div className="field">
              <label htmlFor="rs">Roster Size (excluding IR)</label>
              <input id="rs" type="number" min={1} value={Number.isNaN(league.rosterSize) ? '' : league.rosterSize} onChange={(e) => setLeague({ ...league, rosterSize: num(e.target.value) })} />
            </div>
            <div className="field">
              <label htmlFor="ir">IR Slots (extra)</label>
              <input id="ir" type="number" min={0} value={Number.isNaN(league.irSlots) ? '' : league.irSlots} onChange={(e) => setLeague({ ...league, irSlots: num(e.target.value) })} />
            </div>
          </div>

          <h3>
            Daily Lineup Slots <span className="muted small">({filledActive} active · {Number.isNaN(league.rosterSize) ? '–' : Math.max(0, league.rosterSize - filledActive)} bench)</span>
          </h3>
          {league.slots.map((s, i) => (
            <div className="slot-row" key={i}>
              <input aria-label="Slot name" value={s.label} onChange={(e) => updSlot(i, { label: e.target.value })} />
              <input aria-label={`${s.label} count`} type="number" min={0} value={Number.isNaN(s.count) ? '' : s.count} onChange={(e) => updSlot(i, { count: num(e.target.value) })} />
              <span>
                <PosToggles value={s.accepts} onChange={(accepts) => updSlot(i, { accepts })} />
              </span>
              <button className="icon-btn" aria-label={`Remove ${s.label}`} onClick={() => setLeague({ ...league, slots: league.slots.filter((_, k) => k !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className="btn small"
              onClick={() => setLeague({ ...league, slots: [...league.slots, { id: `slot-${Date.now().toString(36)}`, label: 'F', count: 1, accepts: ['C', 'LW', 'RW'] }] })}
            >
              Add Slot
            </button>
            <button className="btn small ghost" onClick={() => setLeague(structuredClone(DEFAULT_LEAGUE))}>
              Restore Defaults
            </button>
          </div>
          {leagueErrors.length > 0 && (
            <div className="notice error" style={{ marginTop: 8 }}>
              {leagueErrors.join(' ')}
            </div>
          )}

          <h3>Fantasy Playoff Rounds</h3>
          {periods.map((p, i) => (
            <div className="period-row" key={p.id}>
              <input aria-label="Round name" value={p.name} onChange={(e) => updPeriod(i, { name: e.target.value })} />
              <input aria-label={`${p.name} start`} type="date" value={p.start} onChange={(e) => updPeriod(i, { start: e.target.value })} />
              <input aria-label={`${p.name} end`} type="date" value={p.end} onChange={(e) => updPeriod(i, { end: e.target.value })} />
              <button className="icon-btn" aria-label={`Remove ${p.name}`} disabled={periods.length <= 1} onClick={() => setPeriods(periods.filter((_, k) => k !== i))}>
                ✕
              </button>
              {periodErrors[i] && <span className="badge bad" style={{ gridColumn: '1 / -1', justifySelf: 'start' }}>{periodErrors[i]}</span>}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className="btn small"
              onClick={() => {
                const last = periods[periods.length - 1];
                setPeriods([...periods, { id: `p-${Date.now().toString(36)}`, name: `Round ${periods.length + 1}`, start: last?.end ?? '2027-03-01', end: last?.end ?? '2027-03-07' }]);
              }}
            >
              Add Round
            </button>
            <button className="btn small ghost" onClick={() => setPeriods(structuredClone(DEFAULT_PERIODS))}>
              Restore 2027 Defaults
            </button>
          </div>
          <div className="modal-actions">
            <button className="btn ghost" disabled={!dirty} onClick={discard}>
              Discard changes
            </button>
            <button className="btn primary" disabled={hasErrors} onClick={save}>
              Save
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
