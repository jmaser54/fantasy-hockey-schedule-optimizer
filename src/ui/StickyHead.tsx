import { useId, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * A table with a persistent header and natural scrolling (2026-11-24), shared by the Schedule grid,
 * Roster Evaluation and Player Rankings.
 *
 * - The PAGE does all vertical scrolling: the table area (`.sh-scroll`) scrolls horizontally only
 *   (overflow-y hidden), so there is never a second vertical scroller to hand gestures to.
 * - Pinned columns are native `position: sticky; left` cells inside that horizontal scroller.
 * - The header is a copy of the table's header row in a zero-height strip (`.sh-head`) that is
 *   page-sticky under the tab bar. It follows the table sideways through a CSS scroll-driven animation
 *   (`scroll-timeline` on the scroller, `animation-timeline` on the strip), which browsers run with the
 *   scroll itself (Safari 26+ on the compositor) — no JavaScript scroll syncing. Its pinned cells get the
 *   opposite animation, so they stay put. Sideways edge bounce is off, so the two can't drift apart.
 * - JavaScript only MEASURES on layout changes (not on scroll): the scroll distance for the animation,
 *   the tab bar height, and, for tables with automatic column widths, the column widths of the copy.
 * - Without scroll-driven animations (older browsers) the strip is hidden and the table's own header
 *   row shows instead: aligned, just not sticky.
 * The table's own header row stays in place under the strip (invisible) to keep the column widths and
 * space; the strip is the visible, interactive header.
 */
export function StickyHeadTable(props: {
  tableClass: string;
  /** Header row(s): rendered in the strip and, invisibly, in the table. */
  head: ReactNode;
  colgroup?: ReactNode;
  children: ReactNode;
  /** Columns have fixed widths from CSS (Schedule): no width measuring needed. */
  fixedLayout?: boolean;
  scrollClass?: string;
}) {
  const name = `--sh-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const strip = useRef<HTMLTableElement>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const r = root.current;
      const s = scroller.current;
      const t = table.current;
      const h = strip.current;
      if (!r || !s || !t || !h) return;
      const bar = document.querySelector('.tabbar')?.getBoundingClientRect().height ?? 0;
      r.style.setProperty('--sh-top', `${Math.round(bar)}px`);
      r.style.setProperty('--sh-max', `${Math.max(0, s.scrollWidth - s.clientWidth)}px`);
      // The strip's real height: it then leaves the screen together with the table's last row.
      r.style.setProperty('--sh-h', `${Math.round(h.getBoundingClientRect().height)}px`);
      if (!props.fixedLayout) {
        // Copy the table's real column widths onto the header copy (auto-width tables).
        const src = t.tHead?.rows[0]?.cells;
        const dst = h.tHead?.rows[0]?.cells;
        if (src && dst && src.length === dst.length) {
          h.style.width = `${t.getBoundingClientRect().width}px`;
          for (let i = 0; i < src.length; i++) {
            const w = `${src[i]!.getBoundingClientRect().width}px`;
            dst[i]!.style.width = w;
            dst[i]!.style.minWidth = w;
            dst[i]!.style.maxWidth = w;
          }
        }
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (table.current) ro.observe(table.current);
    if (scroller.current) ro.observe(scroller.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  return (
    <div className="sh" ref={root} style={{ timelineScope: name, '--sh-tl': name } as CSSProperties}>
      <div className="sh-head">
        <div className="sh-clip">
          <table ref={strip} className={`${props.tableClass} sh-strip`}>
            {props.colgroup}
            <thead>{props.head}</thead>
          </table>
        </div>
      </div>
      <div ref={scroller} className={`sh-scroll ${props.scrollClass ?? ''}`} style={{ scrollTimeline: `${name} x` } as CSSProperties}>
        <table ref={table} className={props.tableClass}>
          {props.colgroup}
          <thead className="sh-under">{props.head}</thead>
          {props.children}
        </table>
      </div>
    </div>
  );
}
