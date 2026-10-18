// SERVER: GET /<dataset>/<slug>/file/<...path>: the raw bytes of ONE file of an okf bundle or skill directory, so
// an image (or any other file) that a body references by a bundle-relative path loads in the browser.
// rewriteRenderedHtml (links.ts) points `<img src>` and non-markdown `<a href>` here (registry `fileUrl`); the
// Files panel links non-markdown files here. Disk is the truth: `no-cache` plus an ETag, so a changed file shows
// on the next load. No astro:* imports, so it is unit-testable (tests/unit/bundle-file.test.ts).
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { isOkfDatasetId } from '../datasets/registry.ts';
import { classifyBundleFile, normalizeBundlePath, resolveBundleFile } from './bundles.ts';
import { resolveDataDir } from './data-dir.ts';

/** Types a browser shows inline (images, media, PDF); any other file is text/plain (text) or a download. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

/** An SVG opened on its own runs no script and loads nothing but itself and data: images. */
const SVG_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

function plainError(status: 400 | 404, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** `content-type` of a bundle file: by extension, else text/plain for text and octet-stream for binary. */
export async function bundleFileContentType(abs: string, relPath: string): Promise<string> {
  const known = CONTENT_TYPES[path.posix.extname(relPath).toLowerCase()];
  if (known !== undefined) return known;
  return (await classifyBundleFile(abs, relPath)) === 'binary'
    ? 'application/octet-stream'
    : 'text/plain; charset=utf-8';
}

/**
 * The response for GET /<dataset>/<slug>/file/<rawPath>: 200 with the file (a lazily read Blob), 304 when `If-None-Match`
 * matches its ETag, 400 for a path normalizeBundlePath refuses, 404 for a dataset without bundles, a missing
 * entry or file, or a symlink that leaves the bundle (resolveBundleFile).
 */
export async function bundleFileResponse(
  dataset: string,
  slug: string,
  rawPath: string | undefined,
  request: Request,
  dataDir: string = resolveDataDir(),
): Promise<Response> {
  if (dataset !== 'skill' && !isOkfDatasetId(dataset)) return plainError(404, 'Not found');
  const relPath = normalizeBundlePath(rawPath);
  if (relPath === null) return plainError(400, 'Bad path');
  const file = await resolveBundleFile(dataset, slug, relPath, dataDir);
  if (!file.ok) return plainError(file.reason === 'bad-path' ? 400 : 404, 'Not found');

  const contentType = await bundleFileContentType(file.realAbs, relPath);
  const headers = new Headers({
    'cache-control': 'no-cache',
    etag: `W/"${file.size.toString(16)}-${Math.trunc(file.mtime.getTime()).toString(16)}"`,
    'last-modified': file.mtime.toUTCString(),
    'x-content-type-options': 'nosniff',
  });
  if (request.headers.get('if-none-match') === headers.get('etag')) {
    return new Response(null, { status: 304, headers });
  }
  let blob: Blob;
  try {
    blob = await openAsBlob(file.realAbs);
  } catch {
    return plainError(404, 'Not found');
  }
  headers.set('content-type', contentType);
  headers.set('content-length', String(blob.size));
  if (contentType === 'image/svg+xml') headers.set('content-security-policy', SVG_CSP);
  return new Response(blob, { status: 200, headers });
}
