import { describe, expect, it } from 'vitest';
import { ancestorDirs, buildFileTree } from '../../src/lib/file-tree.ts';
import type { FileTreeNode } from '../../src/lib/file-tree.ts';

/** The tree as indented lines: `dir/ (n)` for folders, the name for files. */
function outline(nodes: FileTreeNode<{ path: string }>[], depth = 0): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'dir'
      ? [
          `${'  '.repeat(depth)}${node.name}/ (${node.fileCount})`,
          ...outline(node.children, depth + 1),
        ]
      : [`${'  '.repeat(depth)}${node.name}`],
  );
}

describe('buildFileTree', () => {
  it('nests by folder and keeps the input order at every level', () => {
    const files = [
      'index.md',
      'log.md',
      'concepts/old/a.md',
      'concepts/old/b.md',
      'concepts/search.md',
      'img/now.png',
      'README.txt',
    ].map((path) => ({ path }));
    expect(outline(buildFileTree(files))).toEqual([
      'index.md',
      'log.md',
      'concepts/ (3)',
      '  old/ (2)',
      '    a.md',
      '    b.md',
      '  search.md',
      'img/ (1)',
      '  now.png',
      'README.txt',
    ]);
  });

  it('gives folders their bundle-relative path and files their item', () => {
    const tree = buildFileTree([{ path: 'a/b/c.md', id: 1 }]);
    const a = tree[0];
    expect(a).toMatchObject({ kind: 'dir', name: 'a', path: 'a' });
    const b = a?.kind === 'dir' ? a.children[0] : undefined;
    expect(b).toMatchObject({ kind: 'dir', name: 'b', path: 'a/b', fileCount: 1 });
    const c = b?.kind === 'dir' ? b.children[0] : undefined;
    expect(c).toEqual({ kind: 'file', name: 'c.md', file: { path: 'a/b/c.md', id: 1 } });
  });

  it('is empty for no files', () => {
    expect(buildFileTree([])).toEqual([]);
  });
});

describe('ancestorDirs', () => {
  it('lists every folder that contains the file, none for a root file', () => {
    expect([...ancestorDirs('concepts/old/a.md')]).toEqual(['concepts', 'concepts/old']);
    expect([...ancestorDirs('index.md')]).toEqual([]);
  });
});
