import type { ISODate } from './types.ts';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in YYYY-MM-DD form. */
export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return (
    dt.getUTCFullYear() === Number(y) &&
    dt.getUTCMonth() === Number(mo) - 1 &&
    dt.getUTCDate() === Number(d)
  );
}

function toUTC(date: ISODate): number {
  if (!isValidISODate(date)) throw new Error(`Invalid date: ${String(date)}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromUTC(toUTC(date) + days * 86_400_000);
}

/** Inclusive list of dates from start to end. Empty if end < start. */
export function eachDate(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const endMs = toUTC(end);
  for (let ms = toUTC(start); ms <= endMs; ms += 86_400_000) out.push(fromUTC(ms));
  return out;
}

/** Inclusive containment; ISO strings compare lexicographically. */
export function inRange(date: ISODate, start: ISODate, end: ISODate): boolean {
  return date >= start && date <= end;
}

export function dayCount(start: ISODate, end: ISODate): number {
  return Math.max(0, Math.round((toUTC(end) - toUTC(start)) / 86_400_000) + 1);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekday(date: ISODate): string {
  return WEEKDAYS[new Date(toUTC(date)).getUTCDay()]!;
}

/** "Feb 22" */
export function formatShort(date: ISODate): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Feb 22 – Mar 7, 2027" */
export function formatRange(start: ISODate, end: ISODate): string {
  const sy = start.slice(0, 4);
  const ey = end.slice(0, 4);
  return sy === ey
    ? `${formatShort(start)} – ${formatShort(end)}, ${ey}`
    : `${formatShort(start)}, ${sy} – ${formatShort(end)}, ${ey}`;
}

/**
 * Convert a UTC instant plus the NHL-provided Eastern offset ("-05:00") into
 * the Eastern calendar date. Used only when a game record lacks gameDate.
 */
export function easternDateFromUTC(startTimeUTC: string, easternOffset: string): ISODate {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(easternOffset);
  if (!m) throw new Error(`Bad offset ${easternOffset}`);
  const sign = m[1] === '-' ? -1 : 1;
  const offsetMs = sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
  const ms = Date.parse(startTimeUTC);
  if (Number.isNaN(ms)) throw new Error(`Bad time ${startTimeUTC}`);
  return fromUTC(ms + offsetMs);
}
