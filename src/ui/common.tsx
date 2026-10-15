import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildPlayerIndex, searchPlayers } from '../domain/rosterImport.ts';
import { POSITIONS, POSITION_LABELS, type Player, type Position } from '../domain/types.ts';
import { useApp } from './context.ts';

export function PosBadges({ positions }: { positions: readonly Position[] }) {
  return (
    <>
      {positions.map((p) => (
        <span key={p} className="pos" title={POSITION_LABELS[p]}>
          {p}
        </span>
      ))}
    </>
  );
}

export function PosToggles({ value, onChange }: { value: readonly Position[]; onChange: (v: Position[]) => void }) {
  return (
    <span className="pos-toggles">
      {POSITIONS.map((p) => (
        <button
          key={p}
          type="button"
          title={POSITION_LABELS[p]}
          aria-pressed={value.includes(p)}
          onClick={() => onChange(value.includes(p) ? value.filter((x) => x !== p) : POSITIONS.filter((x) => x === p || value.includes(x)))}
        >
          {p}
        </button>
      ))}
    </span>
  );
}

export function usePlayerIndex() {
  const { data, state } = useApp();
  return useMemo(() => buildPlayerIndex([...data.players, ...state.customPlayers]), [data.players, state.customPlayers]);
}

/** Search box with keyboard-navigable autocomplete. */
export function PlayerSearch(props: {
  onPick: (p: Player) => void;
  exclude?: ReadonlySet<string>;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const index = usePlayerIndex();
  const { teams } = useApp();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const results = useMemo(() => searchPlayers(q, index, 10).filter((p) => !props.exclude?.has(p.id)), [q, index, props.exclude]);
  const pick = (p: Player | undefined) => {
    if (!p) return;
    props.onPick(p);
    setQ('');
    setActive(0);
  };
  return (
    <div className="search">
      <input
        value={q}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder ?? 'Add a player…'}
        aria-label="Search players"
        aria-autocomplete="list"
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter') pick(results[active]);
          else if (e.key === 'Escape') setOpen(false);
          else return;
          e.preventDefault();
        }}
      />
      {open && q.trim().length >= 2 && (
        <ul className="suggest" role="listbox">
          {results.length === 0 && <li className="muted">No players match “{q}”</li>}
          {results.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active} onMouseDown={(e) => (e.preventDefault(), pick(p))} onMouseEnter={() => setActive(i)}>
              <span>{p.name}</span>
              <PosBadges positions={p.positions} />
              <span className="meta">
                {teams.get(p.team)?.name ?? p.team}
                {(p as { inactive?: boolean }).inactive ? ' · not on NHL roster' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function isInactive(p: Player | undefined): boolean {
  return Boolean(p && (p as { inactive?: boolean }).inactive);
}

export function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="muted">+0</span>;
  return <span className={value > 0 ? 'delta-pos' : 'delta-neg'}>{value > 0 ? `+${value}` : `−${-value}`}</span>;
}

/** Small "i" button that reveals an explanation on hover, or on click/tap (mobile, keyboard). */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <span className="infotip" ref={ref} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button type="button" className="info-btn" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        i
      </button>
      {(open || hover) && (
        <span id={id} role="tooltip" className="infotip-pop">
          {children}
        </span>
      )}
    </span>
  );
}

/** ★ toggle for a roster player's Preferred status. */
export function PreferredToggle({ id, name, preferred }: { id: string; name: string; preferred: boolean }) {
  const { dispatch } = useApp();
  return (
    <button
      type="button"
      className="star"
      aria-pressed={preferred}
      aria-label={`Preferred: ${name}`}
      title={preferred ? 'Preferred: gets lineup spots first. Click to remove.' : 'Mark as preferred so they get lineup spots first'}
      onClick={() => dispatch({ type: 'updateEntry', id, patch: { preferred: !preferred } })}
    >
      {preferred ? '★' : '☆'}
    </button>
  );
}
