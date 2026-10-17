import { describe, expect, it } from 'vitest';
import { formatAbsolute, formatRelative, isStale, toYmd, todayYmd } from '../../src/lib/time.ts';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Local-time construction keeps these tests independent of the machine's time zone.
const NOW = new Date(2026, 9, 17, 12, 0, 0).getTime();
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
const ahead = (ms: number): string => new Date(NOW + ms).toISOString();

describe('formatRelative', () => {
  it('says "just now" under 45 seconds, in both directions', () => {
    expect(formatRelative(ago(0), NOW)).toBe('just now');
    expect(formatRelative(ago(44 * SEC), NOW)).toBe('just now');
    expect(formatRelative(ahead(44 * SEC), NOW)).toBe('just now');
  });

  it('switches to minutes at 45 seconds', () => {
    expect(formatRelative(ago(45 * SEC), NOW)).toBe('1 minute ago');
    expect(formatRelative(ago(5 * MIN), NOW)).toBe('5 minutes ago');
    expect(formatRelative(ago(44 * MIN), NOW)).toBe('44 minutes ago');
  });

  it('switches to hours at 45 minutes', () => {
    expect(formatRelative(ago(45 * MIN), NOW)).toBe('1 hour ago');
    expect(formatRelative(ago(3 * HOUR), NOW)).toBe('3 hours ago');
    expect(formatRelative(ago(21 * HOUR), NOW)).toBe('21 hours ago');
  });

  it('switches to days at 22 hours (numeric: auto → yesterday)', () => {
    expect(formatRelative(ago(22 * HOUR), NOW)).toBe('yesterday');
    expect(formatRelative(ago(DAY), NOW)).toBe('yesterday');
    expect(formatRelative(ago(4 * DAY), NOW)).toBe('4 days ago');
    expect(formatRelative(ago(25 * DAY), NOW)).toBe('25 days ago');
  });

  it('switches to months at 26 days', () => {
    expect(formatRelative(ago(26 * DAY), NOW)).toBe('last month');
    expect(formatRelative(ago(60 * DAY), NOW)).toBe('2 months ago');
    expect(formatRelative(ago(300 * DAY), NOW)).toBe('10 months ago');
  });

  it('switches to years at 11 months', () => {
    expect(formatRelative(ago(335 * DAY), NOW)).toBe('last year');
    expect(formatRelative(ago(365 * DAY), NOW)).toBe('last year');
    expect(formatRelative(ago(800 * DAY), NOW)).toBe('2 years ago');
  });

  it('formats the future with the same thresholds', () => {
    expect(formatRelative(ahead(5 * MIN), NOW)).toBe('in 5 minutes');
    expect(formatRelative(ahead(3 * HOUR), NOW)).toBe('in 3 hours');
    expect(formatRelative(ahead(DAY), NOW)).toBe('tomorrow');
    expect(formatRelative(ahead(60 * DAY), NOW)).toBe('in 2 months');
    expect(formatRelative(ahead(800 * DAY), NOW)).toBe('in 2 years');
  });

  it('is deterministic for a fixed nowMs and returns unparseable input unchanged', () => {
    expect(formatRelative(ago(3 * HOUR), NOW)).toBe(formatRelative(ago(3 * HOUR), NOW));
    expect(formatRelative('not a date', NOW)).toBe('not a date');
  });
});

describe('formatAbsolute', () => {
  it('formats YYYY-MM-DD HH:mm in local time', () => {
    expect(formatAbsolute(new Date(2026, 9, 17, 14, 5).toISOString())).toBe('2026-10-17 14:05');
    expect(formatAbsolute(new Date(2026, 0, 2, 3, 4).toISOString())).toBe('2026-01-02 03:04');
    expect(formatAbsolute(new Date(2026, 11, 31, 23, 59).toISOString())).toBe('2026-12-31 23:59');
  });

  it('returns unparseable input unchanged', () => {
    expect(formatAbsolute('garbage')).toBe('garbage');
  });
});

describe('todayYmd', () => {
  it('is the LOCAL calendar day', () => {
    expect(todayYmd(new Date(2026, 9, 17, 0, 0, 1).getTime())).toBe('2026-10-17');
    expect(todayYmd(new Date(2026, 9, 17, 23, 59, 59).getTime())).toBe('2026-10-17');
    expect(todayYmd(new Date(2026, 0, 5, 12).getTime())).toBe('2026-01-05');
  });
});

describe('toYmd', () => {
  it('reads a Date in UTC (YAML dates are 00:00Z)', () => {
    expect(toYmd(new Date('2027-04-01T00:00:00.000Z'))).toBe('2027-04-01');
    expect(toYmd(new Date('2027-04-01T23:59:59.000Z'))).toBe('2027-04-01');
  });

  it('passes YYYY-MM-DD strings through', () => {
    expect(toYmd('2027-04-01')).toBe('2027-04-01');
  });

  it('normalizes full ISO strings to the UTC day', () => {
    expect(toYmd('2027-04-01T00:00:00.000Z')).toBe('2027-04-01');
  });

  it('copes with invalid input', () => {
    expect(toYmd('soon')).toBe('soon');
    expect(toYmd(new Date('nope'))).toBe('');
  });
});

describe('isStale', () => {
  const today = new Date(2026, 9, 17, 9, 30).getTime();

  it('is stale on the boundary day and after, fresh before', () => {
    expect(isStale('2026-10-17', today)).toBe(true); // same day
    expect(isStale('2026-10-16', today)).toBe(true);
    expect(isStale('2026-10-18', today)).toBe(false);
    expect(isStale('2026-01-01', today)).toBe(true);
  });

  it('accepts a Date at 00:00Z', () => {
    expect(isStale(new Date('2026-10-17T00:00:00.000Z'), today)).toBe(true);
    expect(isStale(new Date('2027-04-01T00:00:00.000Z'), today)).toBe(false);
  });

  it('undefined and unparseable values are not stale', () => {
    expect(isStale(undefined, today)).toBe(false);
    expect(isStale('whenever', today)).toBe(false);
    expect(isStale(new Date('nope'), today)).toBe(false);
  });
});
