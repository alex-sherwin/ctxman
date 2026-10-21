// NODE (node:fs, node:zlib): bounded, read-only reads of agent history files (concepts/agent-history.md). A listing
// reads only part of a big file (its head, or head + tail, cut to complete lines); a `.zst` file (Codex) is
// stream-decompressed and the stream dropped once enough text is in. Nothing here ever writes.
import { createReadStream } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { createZstdDecompress, zstdDecompressSync } from 'node:zlib';

/** The text of `buffer` up to (not including) its last newline: complete lines only. */
function completeLines(buffer: Buffer): string {
  const end = buffer.lastIndexOf(0x0a);
  return end === -1 ? '' : buffer.subarray(0, end).toString('utf8');
}

/** The text after the first newline of `buffer`: the lines that started inside it. */
function linesAfterFirstBreak(buffer: Buffer): string {
  const start = buffer.indexOf(0x0a);
  return start === -1 ? '' : buffer.subarray(start + 1).toString('utf8');
}

async function readRange(abs: string, start: number, length: number): Promise<Buffer> {
  const handle = await open(abs, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** The whole file when it is at most `max` bytes; else its first `max` bytes cut to complete lines. */
export async function readHead(abs: string, size: number, max: number): Promise<string> {
  if (size <= max) return readFile(abs, 'utf8');
  return completeLines(await readRange(abs, 0, max));
}

/**
 * The whole file when it is at most `head + tail` bytes; else its first `head` bytes and its last `tail` bytes, each
 * cut to complete lines and joined by a newline (the lines in between are not read).
 */
export async function readHeadTail(
  abs: string,
  size: number,
  head: number,
  tail: number,
): Promise<string> {
  if (size <= head + tail) return readFile(abs, 'utf8');
  const first = completeLines(await readRange(abs, 0, head));
  const last = linesAfterFirstBreak(await readRange(abs, size - tail, tail));
  return `${first}\n${last}`;
}

/** The first `max` bytes of the decompressed text of a zstd file, cut to complete lines (the rest is never inflated). */
export async function readZstdHead(abs: string, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  const input = createReadStream(abs);
  const inflate = createZstdDecompress();
  input.on('error', (error) => inflate.destroy(error));
  input.pipe(inflate);
  try {
    for await (const chunk of inflate as AsyncIterable<Buffer>) {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= max) break;
    }
  } finally {
    input.destroy();
    inflate.destroy();
  }
  const buffer = Buffer.concat(chunks);
  return total >= max ? completeLines(buffer.subarray(0, max)) : buffer.toString('utf8');
}

/** Largest decompressed size of one zstd history file a detail read inflates. */
const ZSTD_MAX_OUTPUT = 1024 * 1024 * 1024;

/** The whole text of a history file (`zst`: decompressed). */
export async function readWholeText(abs: string, zstd: boolean): Promise<string> {
  const buffer = await readFile(abs);
  if (!zstd) return buffer.toString('utf8');
  return zstdDecompressSync(buffer, { maxOutputLength: ZSTD_MAX_OUTPUT }).toString('utf8');
}

/** A small text file (workspace.json, workspace.yaml) or undefined when it is missing, unreadable or too big. */
export async function readSmallText(abs: string, max = 256 * 1024): Promise<string | undefined> {
  try {
    const buffer = await readFile(abs);
    return buffer.length > max ? undefined : buffer.toString('utf8');
  } catch {
    return undefined;
  }
}
