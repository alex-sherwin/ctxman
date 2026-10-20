// PURE (no fs; browser-safe): a flat list of bundle files (bundle-relative posix paths, in tree order: see
// src/lib/bundles.ts#listBundleFiles) as a nested folder tree for the Files panel (src/components/FileTree.astro).

export interface FileTreeFile<F> {
  kind: 'file';
  /** The file name without its folders: 'search.md'. */
  name: string;
  file: F;
}

export interface FileTreeDir<F> {
  kind: 'dir';
  /** The folder name: 'concepts'. */
  name: string;
  /** Bundle-relative path of the folder, no trailing slash: 'concepts/old'. */
  path: string;
  children: FileTreeNode<F>[];
  /** Files anywhere below this folder. */
  fileCount: number;
}

export type FileTreeNode<F> = FileTreeFile<F> | FileTreeDir<F>;

/**
 * Nests `files` by folder. The input order is kept at every level (a folder sits where its first file was), so
 * `listBundleFiles`' order (the entry and the root log.md first, folders before files) carries over.
 */
export function buildFileTree<F extends { path: string }>(files: readonly F[]): FileTreeNode<F>[] {
  const root: FileTreeNode<F>[] = [];
  const dirs = new Map<string, FileTreeDir<F>>();
  for (const file of files) {
    const segments = file.path.split('/');
    const name = segments.pop() ?? file.path;
    let level = root;
    let dirPath = '';
    const chain: FileTreeDir<F>[] = [];
    for (const segment of segments) {
      dirPath = dirPath === '' ? segment : `${dirPath}/${segment}`;
      let dir = dirs.get(dirPath);
      if (dir === undefined) {
        dir = { kind: 'dir', name: segment, path: dirPath, children: [], fileCount: 0 };
        dirs.set(dirPath, dir);
        level.push(dir);
      }
      chain.push(dir);
      level = dir.children;
    }
    for (const dir of chain) dir.fileCount++;
    level.push({ kind: 'file', name, file });
  }
  return root;
}

/** The folders that contain `filePath` ('concepts/old/x.md' -> 'concepts', 'concepts/old'): the ones shown open. */
export function ancestorDirs(filePath: string): Set<string> {
  const out = new Set<string>();
  const segments = filePath.split('/').slice(0, -1);
  let dirPath = '';
  for (const segment of segments) {
    dirPath = dirPath === '' ? segment : `${dirPath}/${segment}`;
    out.add(dirPath);
  }
  return out;
}
