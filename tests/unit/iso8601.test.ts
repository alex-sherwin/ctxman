import { describe, expect, it } from 'vitest';
import {
  durationSeconds,
  formatSeconds,
  isIsoDateTime,
  isIsoDuration,
  localIsoMinutes,
  normalizeIsoDuration,
  parseIsoDuration,
  timeTotalText,
  totalDurationSeconds,
} from '../../src/lib/iso8601.ts';

describe('ISO 8601 durations', () => {
  it('accepts every designator, alone or combined, with a fraction on the smallest part', () => {
    for (const ok of [
      'PT1H',
      'PT45M',
      'PT30S',
      'PT1H30M',
      'P1D',
      'P2W',
      'P1Y2M3DT4H5M6S',
      'P1DT12H',
      'PT0.5H',
      'PT1,5H',
      'PT1H30.5M',
      'P0D',
    ]) {
      expect(isIsoDuration(ok), ok).toBe(true);
    }
  });

  it('refuses empty, misplaced, lower-case and malformed values', () => {
    for (const bad of [
      '',
      'P',
      'PT',
      'P1DT',
      'PT1.5H30M',
      '1h',
      'pt1h',
      'P1H',
      'PT1D',
      'P-1D',
      'PT1H 30M',
      ' PT1H',
      'P1M1Y',
      'PT1H1H',
    ]) {
      expect(isIsoDuration(bad), bad).toBe(false);
    }
  });

  it('parses the parts', () => {
    expect(parseIsoDuration('P1Y2M3W4DT5H6M7.5S')).toEqual({
      years: 1,
      months: 2,
      weeks: 3,
      days: 4,
      hours: 5,
      minutes: 6,
      seconds: 7.5,
    });
    expect(parseIsoDuration('PT1,5H')?.hours).toBe(1.5);
    expect(parseIsoDuration('nope')).toBeNull();
  });

  it('normalizes typed input: trimmed and upper-cased, null when not a duration', () => {
    expect(normalizeIsoDuration(' pt1h30m ')).toBe('PT1H30M');
    expect(normalizeIsoDuration('P1d')).toBe('P1D');
    expect(normalizeIsoDuration('1h30m')).toBeNull();
    expect(normalizeIsoDuration('')).toBeNull();
  });

  it('measures fixed-length durations in seconds (a day is 24 h, a week 7 days); years and months have none', () => {
    expect(durationSeconds('PT1H30M')).toBe(5400);
    expect(durationSeconds('PT0.5H')).toBe(1800);
    expect(durationSeconds('P1DT1H')).toBe(90_000);
    expect(durationSeconds('P1W')).toBe(604_800);
    expect(durationSeconds('P1M')).toBeNull();
    expect(durationSeconds('P1Y')).toBeNull();
    expect(durationSeconds('x')).toBeNull();
    expect(totalDurationSeconds(['PT1H', 'PT30M', 'PT45M'])).toBe(8100);
    expect(totalDurationSeconds([])).toBe(0);
    expect(totalDurationSeconds(['PT1H', 'P1M'])).toBeNull();
  });

  it('formats seconds as hours, minutes and seconds (never days)', () => {
    expect(formatSeconds(0)).toBe('0m');
    expect(formatSeconds(45)).toBe('45s');
    expect(formatSeconds(5400)).toBe('1h 30m');
    expect(formatSeconds(3600)).toBe('1h');
    expect(formatSeconds(90_000)).toBe('25h');
    expect(formatSeconds(3661)).toBe('1h 1m 1s');
    expect(timeTotalText([])).toBe('');
    expect(timeTotalText(['PT1H', 'PT1H30M'])).toBe('Total 2h 30m');
    expect(timeTotalText(['P1M'])).toMatch(/No total/);
  });
});

describe('ISO 8601 dates and date-times (resolved)', () => {
  it('accepts calendar, reduced, week, ordinal and basic dates', () => {
    for (const ok of [
      '2026-10-19',
      '2028-02-29',
      '2026-10',
      '2026',
      '2026-W42',
      '2026-W42-1',
      '2026-292',
      '2028-366',
      '20261019',
    ]) {
      expect(isIsoDateTime(ok), ok).toBe(true);
    }
  });

  it('accepts date-times to the minute, second or fraction, with or without a zone', () => {
    for (const ok of [
      '2026-10-19T14:30',
      '2026-10-19T14:30:05',
      '2026-10-19T14:30:05.123',
      '2026-10-19T14:30:05,5',
      '2026-10-19T14:30Z',
      '2026-10-19T14:30:05+02:00',
      '2026-10-19T14:30-0530',
      '2026-10-19T14:30+02',
      '2026-10-19t14:30',
      '2026-10-19 14:30',
      '2026-10-19T24:00',
      '20261019T1430',
      '20261019T143005Z',
    ]) {
      expect(isIsoDateTime(ok), ok).toBe(true);
    }
  });

  it('refuses impossible values, mixed forms and prose', () => {
    for (const bad of [
      '',
      'yesterday',
      '2026-02-29',
      '2026-13-01',
      '2026-10-32',
      '2026-1-9',
      '2026-W54',
      '2026-366',
      '2026-10T14:30',
      '2026T14:30',
      '2026-10-19T25:00',
      '2026-10-19T24:30',
      '2026-10-19T14:60',
      '2026-10-19T14',
      '2026-10-19T14:30+25:00',
      '2026-10-19T1430',
      '20261019T14:30',
      '2026-10-19T14:30z',
      '2026-10-19T',
    ]) {
      expect(isIsoDateTime(bad), bad).toBe(false);
    }
  });

  it('localIsoMinutes writes the local wall time with its offset, and is itself valid', () => {
    const now = new Date(2026, 9, 19, 14, 30, 59).getTime();
    const value = localIsoMinutes(now);
    expect(value).toMatch(/^2026-10-19T14:30(?:Z|[+-]\d{2}:\d{2})$/);
    expect(isIsoDateTime(value)).toBe(true);
  });
});
