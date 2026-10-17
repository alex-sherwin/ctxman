// PURE time helpers (UI_SPEC §0.5, PLAN §E.12). No Date.now() here: callers pass `nowMs` explicitly
// (islands read it from the $now store) so SSR, tests and the browser agree and render stays pure.

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30.4375 * DAY;
const YEAR = 365.25 * DAY;

const YMD_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Relative time in English: "just now" (<45s), "5 minutes ago" (<45min), "3 hours ago" (<22h),
 * "yesterday"/"4 days ago" (<26d), "last month"/"3 months ago" (<11mo), then years. Future times use
 * the same thresholds ("in 5 minutes"). An unparseable `iso` is returned unchanged.
 */
export function formatRelative(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diff = nowMs - then;
  const abs = Math.abs(diff);
  if (abs < 45 * SECOND) return 'just now';
  // RelativeTimeFormat: negative = past ("ago"), positive = future ("in").
  const sign = diff >= 0 ? -1 : 1;
  if (abs < 45 * MINUTE) return RTF.format(sign * Math.round(abs / MINUTE), 'minute');
  if (abs < 22 * HOUR) return RTF.format(sign * Math.round(abs / HOUR), 'hour');
  if (abs < 26 * DAY) return RTF.format(sign * Math.round(abs / DAY), 'day');
  if (abs < 11 * MONTH) return RTF.format(sign * Math.round(abs / MONTH), 'month');
  return RTF.format(sign * Math.round(abs / YEAR), 'year');
}

/** `YYYY-MM-DD HH:mm` in the local time zone. An unparseable `iso` is returned unchanged. */
export function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Local calendar day of `nowMs` as `YYYY-MM-DD`. */
export function todayYmd(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Calendar day of a YAML/frontmatter date as `YYYY-MM-DD`. A `Date` is read in UTC (YAML dates parse
 * to 00:00Z); a bare `YYYY-MM-DD` string passes through; any other string is parsed and read in UTC,
 * and returned unchanged when it is not a date at all.
 */
export function toYmd(value: Date | string): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  if (YMD_ONLY.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10);
}

/** True when the local day of `nowMs` is on or after `staleAfter`. `undefined`/unparseable → false. */
export function isStale(staleAfter: Date | string | undefined, nowMs: number): boolean {
  if (staleAfter === undefined) return false;
  const ymd = toYmd(staleAfter);
  if (!YMD_ONLY.test(ymd)) return false;
  return todayYmd(nowMs) >= ymd;
}
