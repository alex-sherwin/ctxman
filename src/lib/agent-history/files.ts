// NODE (node:fs, node:readline, node:zlib): bounded, read-only reads of agent history files
// (concepts/agent-history.md). A listing reads only part of a big file (its head, or head + tail, cut to complete
// lines); a `.zst` file (Codex) is stream-decompressed. A detail streams the whole file one line at a time
// (jsonLineStream), so the raw text, every parsed line and the transcript are never held together. Nothing here
// ever writes.
import { createReadStream } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { createZstdDecompress } from 'node:zlib';
import { parseJsonLine } from './parse-util.ts';

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

/**
 * The first `head` and the last `tail` bytes of the decompressed text of a zstd file, each cut to complete lines and
 * joined by a newline (the whole text when it is at most `head + tail`). The file is inflated as a stream and only
 * those two windows are kept, so memory stays bounded however big the session is.
 */
export async function readZstdHeadTail(abs: string, head: number, tail: number): Promise<string> {
  const first: Buffer[] = [];
  let firstLength = 0;
  let last: Buffer[] = [];
  let lastLength = 0;
  let total = 0;
  const input = createReadStream(abs);
  const inflate = createZstdDecompress();
  input.on('error', (error) => inflate.destroy(error));
  input.pipe(inflate);
  try {
    for await (const chunk of inflate as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > ZSTD_MAX_OUTPUT) throw new Error(`${abs}: more than 1 GB of decompressed text`);
      let rest = chunk;
      if (firstLength < head) {
        const take = rest.subarray(0, head - firstLength);
        first.push(take);
        firstLength += take.length;
        rest = rest.subarray(take.length);
      }
      if (rest.length === 0) continue;
      last.push(rest);
      lastLength += rest.length;
      // keep at most `tail` bytes (plus the chunk that crosses the boundary)
      while (last.length > 1 && lastLength - (last[0]?.length ?? 0) >= tail) {
        lastLength -= last[0]?.length ?? 0;
        last = last.slice(1);
      }
    }
  } finally {
    input.destroy();
    inflate.destroy();
  }
  const headBuffer = Buffer.concat(first);
  if (lastLength === 0) return headBuffer.toString('utf8');
  const tailBuffer = Buffer.concat(last);
  // The tail joins the head directly (nothing was skipped): the whole text.
  if (total - lastLength === firstLength && lastLength <= tail) {
    return Buffer.concat([headBuffer, tailBuffer]).toString('utf8');
  }
  return `${completeLines(headBuffer)}\n${linesAfterFirstBreak(tailBuffer.subarray(Math.max(0, tailBuffer.length - tail)))}`;
}

/** The last `tail` bytes of a file cut to the lines that start inside them ('' for an empty file). */
export async function readTail(abs: string, size: number, tail: number): Promise<string> {
  if (size <= tail) return readFile(abs, 'utf8');
  return linesAfterFirstBreak(await readRange(abs, size - tail, tail));
}

/** Largest decompressed size of one zstd history file a read inflates. */
const ZSTD_MAX_OUTPUT = 1024 * 1024 * 1024;

/**
 * The JSON values of a history file's lines (`zstd`: decompressed), streamed one line at a time: blank, broken and
 * non-JSON lines are skipped. Only the current line (and the stream's buffers) is in memory, never the whole text.
 */
export async function* jsonLineStream(abs: string, zstd: boolean): AsyncGenerator<unknown> {
  for await (const line of lineStream(abs, zstd)) {
    const value = parseJsonLine(line);
    if (value !== undefined) yield value;
  }
}

/**
 * The lines of a history file (`zstd`: decompressed), streamed one at a time. `end` (uncompressed files only) stops
 * the read at that byte offset (exclusive); the line it cuts is yielded torn, so a JSON parse of it fails.
 */
export async function* lineStream(
  abs: string,
  zstd: boolean,
  end?: number,
): AsyncGenerator<string> {
  if (end !== undefined && end <= 0) return;
  const input = createReadStream(abs, zstd || end === undefined ? {} : { end: end - 1 });
  let source: Readable = input;
  let inflate: Readable | undefined;
  if (zstd) {
    const stream = createZstdDecompress();
    inflate = stream;
    input.on('error', (error) => stream.destroy(error));
    let total = 0;
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > ZSTD_MAX_OUTPUT) {
        stream.destroy(new Error(`${abs}: more than 1 GB of decompressed text`));
      }
    });
    source = input.pipe(stream);
  }
  const lines = createInterface({ input: source, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    yield* lines;
  } finally {
    lines.close();
    input.destroy();
    inflate?.destroy();
  }
}

/** The whole text of a (bounded) history file. */
export async function readWholeText(abs: string): Promise<string> {
  return readFile(abs, 'utf8');
}

/** The whole bytes of a (bounded) history file. */
export async function readWholeBytes(abs: string): Promise<Buffer> {
  return readFile(abs);
}

/**
 * The lines of a file as bytes (no newline), streamed: a line is decoded by its consumer, so a consumer can leave
 * most of a huge line undecoded (vscode.ts#vscodeLogLine). A line longer than one chunk is joined once.
 */
export async function* byteLineStream(abs: string): AsyncGenerator<Buffer> {
  const input = createReadStream(abs);
  let partial: Buffer[] = [];
  try {
    for await (const chunk of input as AsyncIterable<Buffer>) {
      let start = 0;
      for (let end = chunk.indexOf(0x0a, start); end !== -1; end = chunk.indexOf(0x0a, start)) {
        const piece = chunk.subarray(start, end);
        if (partial.length === 0) {
          yield piece;
        } else {
          partial.push(piece);
          const line = Buffer.concat(partial);
          partial = [];
          yield line;
        }
        start = end + 1;
      }
      if (start < chunk.length) partial.push(chunk.subarray(start));
    }
    if (partial.length > 0) yield Buffer.concat(partial);
  } finally {
    input.destroy();
  }
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
