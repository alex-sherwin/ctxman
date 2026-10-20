// PURE (no fs, no Date.now(); browser-safe): the ISO 8601 forms of the time-tracking fields of task, feature, bug
// and rca entries (registry TIME_TRACKED_DATASETS). `time` is a list of DURATIONS (`PT1H30M`, `P1D`, `PT0.5H`) and
// `resolved` a DATE or DATE-TIME in any common ISO 8601 form (see isIsoDateTime). Used by the schemas, the
// frontmatter PATCH and the Details dialog.

// ---------------------------------------------------------------- durations

export interface DurationParts {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const NUM = '(\\d+(?:[.,]\\d+)?)';
/** `PnYnMnWnDTnHnMnS`, every part optional but at least one, `T` only before a time part. */
const DURATION = new RegExp(
  `^P(?!$)(?:${NUM}Y)?(?:${NUM}M)?(?:${NUM}W)?(?:${NUM}D)?(?:T(?=\\d)(?:${NUM}H)?(?:${NUM}M)?(?:${NUM}S)?)?$`,
);

export const DURATION_EXAMPLE = 'PT1H30M';
export const DURATION_MESSAGE = `an ISO 8601 duration such as ${DURATION_EXAMPLE}, PT45M or P1D`;

/**
 * The parts of an ISO 8601 duration (designators upper case, as written in files), or null. A decimal fraction
 * (`.` or `,`) is allowed on the smallest part only (`PT1.5H`, not `PT1.5H30M`).
 */
export function parseIsoDuration(value: string): DurationParts | null {
  const m = DURATION.exec(value);
  if (m === null) return null;
  const raw = m.slice(1, 8);
  const last = raw.findLastIndex((part) => part !== undefined);
  if (last === -1) return null;
  if (raw.some((part, i) => part !== undefined && i < last && /[.,]/.test(part))) return null;
  const [years, months, weeks, days, hours, minutes, seconds] = raw.map((part) =>
    part === undefined ? 0 : Number(part.replace(',', '.')),
  ) as [number, number, number, number, number, number, number];
  return { years, months, weeks, days, hours, minutes, seconds };
}

export function isIsoDuration(value: string): boolean {
  return parseIsoDuration(value) !== null;
}

/** Typed input as a duration to store: trimmed and upper-cased (`pt1h30m` -> `PT1H30M`); null when it is not one. */
export function normalizeIsoDuration(input: string): string | null {
  const value = input.trim().toUpperCase();
  return isIsoDuration(value) ? value : null;
}

/**
 * Length in seconds (a week is 7 days, a day 24 hours); null for an invalid value or one with years or months,
 * whose length depends on the calendar.
 */
export function durationSeconds(value: string): number | null {
  const p = parseIsoDuration(value);
  if (p === null || p.years !== 0 || p.months !== 0) return null;
  return ((p.weeks * 7 + p.days) * 24 + p.hours) * 3600 + p.minutes * 60 + p.seconds;
}

/** The sum of `values` in seconds; null when one of them has no fixed length (see durationSeconds). */
export function totalDurationSeconds(values: readonly string[]): number | null {
  let total = 0;
  for (const value of values) {
    const seconds = durationSeconds(value);
    if (seconds === null) return null;
    total += seconds;
  }
  return total;
}

/** `5400` -> `1h 30m`: hours, minutes and seconds (time worked is counted in hours, never folded into days). */
export function formatSeconds(seconds: number): string {
  const whole = Math.round(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const parts = [h > 0 ? `${h}h` : '', m > 0 ? `${m}m` : '', s > 0 ? `${s}s` : ''].filter(
    (p) => p !== '',
  );
  return parts.length === 0 ? '0m' : parts.join(' ');
}

/** "Total 2h 30m" for a `time` list; '' when it is empty; years and months have no fixed length (no total then). */
export function timeTotalText(values: readonly string[]): string {
  if (values.length === 0) return '';
  const total = totalDurationSeconds(values);
  return total === null
    ? 'No total (a value has years or months)'
    : `Total ${formatSeconds(total)}`;
}

// ---------------------------------------------------------------- dates and date-times

const pad2 = (n: number): string => String(Math.trunc(Math.abs(n))).padStart(2, '0');

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const isYearDay = (year: number, day: number): boolean =>
  day >= 1 && day <= (daysInMonth(year, 2) === 29 ? 366 : 365);

/** `hh:mm[:ss[.fff]]` (extended) or `hhmm[ss[.fff]]` (basic) + an optional `Z` / `±hh[[:]mm]` zone. */
function isTimeOfDay(time: string, basic: boolean): boolean {
  const re = basic
    ? /^(\d{2})(\d{2})(?:(\d{2})(?:[.,]\d+)?)?(Z|[+-]\d{2}(?:\d{2})?)?$/
    : /^(\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;
  const m = re.exec(time);
  if (m === null) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] === undefined ? 0 : Number(m[3]);
  if (min > 59 || s > 60) return false;
  // 24:00 is the end of the day; nothing later.
  if (h > 24 || (h === 24 && (min !== 0 || s !== 0))) return false;
  const zone = m[4];
  if (zone !== undefined && zone !== 'Z') {
    const digits = zone.slice(1).replace(':', '');
    if (Number(digits.slice(0, 2)) > 23 || Number(digits.slice(2) || '0') > 59) return false;
  }
  return true;
}

/** A calendar date in extended (`2026-10-19`, `2026-10`, `2026`, `2026-W42-1`, `2026-292`) or basic (`20261019`) form. */
function isIsoDate(date: string): { ok: boolean; basic: boolean } {
  let m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date);
  if (m !== null) {
    const y = Number(m[1]);
    if (m[2] === undefined) return { ok: true, basic: false };
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return { ok: false, basic: false };
    if (m[3] === undefined) return { ok: true, basic: false };
    const d = Number(m[3]);
    return { ok: d >= 1 && d <= daysInMonth(y, mo), basic: false };
  }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(date);
  if (m !== null) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return { ok: mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo), basic: true };
  }
  m = /^\d{4}-W(\d{2})(?:-([1-7]))?$/.exec(date);
  if (m !== null) return { ok: Number(m[1]) >= 1 && Number(m[1]) <= 53, basic: false };
  m = /^(\d{4})-(\d{3})$/.exec(date);
  if (m !== null) return { ok: isYearDay(Number(m[1]), Number(m[2])), basic: false };
  return { ok: false, basic: false };
}

export const DATE_TIME_EXAMPLE = '2026-10-19T14:30';
export const DATE_TIME_MESSAGE = `an ISO 8601 date or date-time such as 2026-10-19, ${DATE_TIME_EXAMPLE} or 2026-10-19T14:30:00Z`;

/**
 * Any common ISO 8601 date or date-time: a calendar date (`2026-10-19`; reduced `2026-10`, `2026`; week
 * `2026-W42-1`; ordinal `2026-292`; basic `20261019`), optionally followed by `T` (or a space, RFC 3339) and a time
 * (`14:30`, `14:30:05`, `14:30:05.123`; basic `1430`) with an optional zone (`Z`, `+02:00`, `+0200`, `+02`). A time
 * needs a full calendar date in the same form (extended with extended, basic with basic). Values are range-checked
 * (no 2026-02-30, no 25:00).
 */
export function isIsoDateTime(value: string): boolean {
  const m = /^([^Tt ]+)(?:[Tt ](.+))?$/.exec(value);
  if (m === null || m[1] === undefined) return false;
  const date = isIsoDate(m[1]);
  if (!date.ok) return false;
  if (m[2] === undefined) return true;
  const fullDate = date.basic || /^\d{4}-\d{2}-\d{2}$/.test(m[1]);
  return fullDate && isTimeOfDay(m[2], date.basic);
}

/** `nowMs` as a local date-time to the minute with its UTC offset: `2026-10-19T14:30+02:00` (the "Now" button). */
export function localIsoMinutes(nowMs: number): string {
  const d = new Date(nowMs);
  const offset = -d.getTimezoneOffset();
  const zone =
    offset === 0
      ? 'Z'
      : `${offset > 0 ? '+' : '-'}${pad2(Math.floor(Math.abs(offset) / 60))}:${pad2(Math.abs(offset) % 60)}`;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}${zone}`;
}
