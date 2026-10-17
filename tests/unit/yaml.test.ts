import { describe, expect, it } from 'vitest';
import { parseYaml, stringifyYaml } from '../../src/lib/yaml.ts';

describe('parseYaml', () => {
  it('parses unquoted dates (and timestamps) to Date objects, like astro', () => {
    const value = parseYaml('day: 2026-12-01\nstamp: 2026-10-17T10:20:30Z\n') as {
      day: Date;
      stamp: Date;
    };
    expect(value.day).toBeInstanceOf(Date);
    expect(value.day.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(value.stamp.toISOString()).toBe('2026-10-17T10:20:30.000Z');
  });

  it('keeps quoted dates as strings', () => {
    expect(parseYaml('day: \'2026-12-01\'\nother: "2026-12-02"\n')).toEqual({
      day: '2026-12-01',
      other: '2026-12-02',
    });
  });

  it('uses the core schema: yes/no stay strings, true/false and numbers are typed', () => {
    expect(parseYaml('a: yes\nb: true\nc: 12\nd: null\ne: ~\n')).toEqual({
      a: 'yes',
      b: true,
      c: 12,
      d: null,
      e: null,
    });
  });

  it('supports merge keys', () => {
    const value = parseYaml('base: &b\n  x: 1\nchild:\n  <<: *b\n  y: 2\n') as {
      child: Record<string, number>;
    };
    expect(value.child).toEqual({ x: 1, y: 2 });
  });

  it('returns undefined for an empty document', () => {
    expect(parseYaml('')).toBeUndefined();
    expect(parseYaml('# only a comment\n')).toBeUndefined();
  });

  it('parses block scalars', () => {
    expect(parseYaml('notes: |\n  one\n  two\n')).toEqual({ notes: 'one\ntwo\n' });
  });

  it('throws the first parse error', () => {
    expect(() => parseYaml('a: [1, 2\n')).toThrow();
    expect(() => parseYaml('a: 1\na: 2\n')).toThrow(/duplicate|unique/i);
  });
});

describe('stringifyYaml', () => {
  it('writes multi-line strings as literal block scalars', () => {
    const out = stringifyYaml({ name: 'x', notes: 'line one\nline two\n' });
    expect(out).toBe('name: x\nnotes: |\n  line one\n  line two\n');
  });

  it('keeps a multi-line string without trailing newline using the strip indicator', () => {
    const out = stringifyYaml({ notes: 'a\nb' });
    expect(out).toBe('notes: |-\n  a\n  b\n');
    expect(parseYaml(out)).toEqual({ notes: 'a\nb' });
  });

  it('never folds long lines', () => {
    const long = 'word '.repeat(60).trim();
    const out = stringifyYaml({ description: long });
    expect(out.trimEnd().split('\n')).toHaveLength(1);
    expect(parseYaml(out)).toEqual({ description: long });
  });

  it('is stable: stringify(parse(stringify(x))) === stringify(x)', () => {
    const value = {
      name: 'ctxman-dev',
      description: 'A context',
      tags: ['a', 'b'],
      links: [
        { dataset: 'kb', slug: 'ctxman', notes: 'First line\n\n- bullet\n- `code`\n' },
        { dataset: 'task', slug: 'write-agents-md' },
        { dataset: 'rca', slug: 'x', notes: '  leading space\nsecond: colon # not a comment\n' },
      ],
    };
    const once = stringifyYaml(value);
    expect(parseYaml(once)).toEqual(value);
    expect(stringifyYaml(parseYaml(once))).toBe(once);
  });

  it('round-trips special strings that need quoting', () => {
    const value = { a: 'true', b: '123', c: 'null', d: '', e: 'x: y', f: '#hash', g: '- dash' };
    expect(parseYaml(stringifyYaml(value))).toEqual(value);
  });

  it('writes dates as YAML timestamps that parse back to Date', () => {
    const date = new Date('2026-10-17T00:00:00.000Z');
    const back = parseYaml(stringifyYaml({ at: date })) as { at: unknown };
    expect(back.at).toBeInstanceOf(Date);
    expect((back.at as Date).getTime()).toBe(date.getTime());
  });
});
