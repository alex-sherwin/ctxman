import { describe, expect, it } from 'vitest';
import { deleteDocMessage, deleteDocSummary } from '../../src/ui/markdown/delete-doc.ts';

const broken = (file: string, line?: number) => ({
  rule: 'links/broken',
  file: `kb/demo/${file}`,
  message: 'still links to the deleted x.md',
  ...(line === undefined ? {} : { line }),
});

describe('deleteDocMessage', () => {
  it('says what was deleted', () => {
    expect(deleteDocMessage('kb', 'demo', { path: 'notes/x.md', warnings: [] })).toBe(
      'Deleted notes/x.md',
    );
  });

  it('names the files (bundle-relative, with lines) that still link to it, three at most', () => {
    expect(deleteDocMessage('kb', 'demo', { path: 'x.md', warnings: [broken('log.md', 5)] })).toBe(
      'Deleted x.md; a link to it remains in log.md:5',
    );
    expect(
      deleteDocMessage('kb', 'demo', {
        path: 'x.md',
        warnings: [
          broken('log.md', 5),
          broken('a.md', 1),
          { rule: 'doc/bookkeeping-failed', file: 'kb/demo/index.md', message: 'x' },
          broken('b.md'),
          broken('c.md', 9),
        ],
      }),
    ).toBe('Deleted x.md; links to it remain in log.md:5, a.md:1, b.md and 1 more');
  });

  it('summarizes the delete for the confirmation', () => {
    expect(deleteDocSummary('kb', 'demo', 'notes/x.md')).toContain('kb/demo/notes/x.md');
  });
});
