// PURE (no fs, no astro:*; browser-safe). Classifies the `uri` of `remote-repo` / `remote-skill`
// reference entries. Hand-written on purpose: `z.url()` rejects scp-style git URIs.
//
//   git:     git@github.com:org/repo.git        (scp-style SSH)
//            ssh://git@host[:port]/org/repo.git
//            https://host/org/repo[.git]         (org/repo, or a single segment ending .git; no credentials, query or hash)
//   archive: https://host/path/name.tar.gz | .tgz | .zip   (remote-skill only)
//
// The two kinds are disjoint: an HTTPS URI whose path ends in an archive extension is an archive.

export type RemoteUriKind = 'git' | 'archive';

export const REMOTE_URI_KIND_LABELS = {
  git: 'git',
  archive: 'archive',
} as const satisfies Record<RemoteUriKind, string>;

const ARCHIVE_EXTENSION = /\.(?:tar\.gz|tgz|zip)$/i;
const SCP_STYLE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:(?!\/)[^\s:][^\s]*$/;
const HAS_WHITESPACE = /\s/;

function parseUrl(uri: string): URL | null {
  if (HAS_WHITESPACE.test(uri)) return null;
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

function pathSegments(url: URL): string[] {
  return url.pathname.split('/').filter((segment) => segment !== '');
}

/** `https://host/…/name.tar.gz|.tgz|.zip` (no credentials, query or hash). */
export function isArchiveUri(uri: string): boolean {
  const url = parseUrl(uri);
  if (url === null || url.protocol !== 'https:' || url.hostname === '') return false;
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '')
    return false;
  const segments = pathSegments(url);
  const last = segments[segments.length - 1];
  return last !== undefined && ARCHIVE_EXTENSION.test(last);
}

/** A git repository URI: scp-style SSH, `ssh://`, or `https://host/org/repo[.git]` (never an archive). */
export function isGitUri(uri: string): boolean {
  if (uri === '' || HAS_WHITESPACE.test(uri)) return false;
  if (!uri.includes('://')) return SCP_STYLE.test(uri);
  const url = parseUrl(uri);
  if (url === null || url.hostname === '') return false;
  if (url.protocol === 'ssh:') return pathSegments(url).length >= 1;
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '')
    return false;
  const segments = pathSegments(url);
  const last = segments[segments.length - 1];
  const looksLikeRepo = segments.length >= 2 || (last !== undefined && last.endsWith('.git'));
  return looksLikeRepo && !isArchiveUri(uri);
}

/** 'archive' | 'git' | null (neither). Archive wins by construction: the kinds never overlap. */
export function classifyRemoteUri(uri: string): RemoteUriKind | null {
  if (isArchiveUri(uri)) return 'archive';
  if (isGitUri(uri)) return 'git';
  return null;
}

export const GIT_URI_MESSAGE =
  'must be a git URI: git@host:org/repo.git, ssh://git@host/org/repo.git or https://host/org/repo[.git]';
export const SKILL_URI_MESSAGE = `${GIT_URI_MESSAGE}, or an https URL ending in .tar.gz, .tgz or .zip`;
