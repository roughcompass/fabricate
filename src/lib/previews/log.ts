import fsp from "node:fs/promises";
import path from "node:path";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { PreviewBuild } from "./records";
import { attemptLogFile } from "./storage";

/**
 * Reading a preview's latest attempt log by byte offset (design decision 9).
 * The preview page shows the log's tail, and while the attempt is Queued or
 * Building asks for what was written after the offset it has, in whole
 * lines. Each worker claim of an attempt writes a log of its own, named for
 * the attempt and the claim, so an offset belongs to one log: asking with
 * another log's name, such as a rebuild's earlier attempt, starts again from
 * the new log's tail.
 */

/** How much of a log's end the first read returns. */
export const LOG_TAIL_BYTES = 64 * 1024;
/** The most one read returns after an offset; a reader that's behind reads again. */
const LOG_CHUNK_BYTES = 256 * 1024;

export interface LogChunk {
  /** The latest attempt. */
  readonly attempt: number;
  /** The name of its log, `<attempt>-<claim>`, or null until a worker starts the attempt. */
  readonly log: string | null;
  /** Where the text starts in the log, in bytes, and where the next read starts. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** Whether lines before +start+ were left out. */
  readonly truncated: boolean;
  /** Whether the offset asked for belonged to another log, so the text starts from this one's tail. */
  readonly reset: boolean;
  /** Whether the log holds more after +end+ that this read didn't return. */
  readonly more: boolean;
}

/** The name the preview's latest attempt log goes by: `<attempt>-<claim>`, from its file name. */
export function logName(preview: Pick<PreviewBuild, "attemptLog">): string | null {
  return preview.attemptLog === null ? null : path.posix.basename(preview.attemptLog, ".log");
}

/**
 * The latest attempt's log after +from+, in whole lines, or its tail when
 * +from+ is absent or belongs to a log other than +log+. A final line
 * without its newline is returned only once nothing more is written to it.
 */
export async function readLogChunk(config: FrontendRegistryConfig, preview: Pick<PreviewBuild, "publicId" | "attempt" | "attemptLog" | "attemptState">, request: { from?: number; log?: string } = {}): Promise<LogChunk> {
  const name = logName(preview);
  const file = attemptLogFile(config, preview);
  const handle = file ? await fsp.open(file, "r").catch(() => null) : null;
  const empty = { attempt: preview.attempt, log: name, text: "", truncated: false, more: false };
  if (!handle) return { ...empty, start: 0, end: 0, reset: request.log !== undefined && request.log !== name };
  try {
    const size = (await handle.stat()).size;
    const reset = (request.log !== undefined && request.log !== name) || (request.from !== undefined && request.from > size);
    const tail = request.from === undefined || reset;
    let start = tail ? Math.max(0, size - LOG_TAIL_BYTES) : request.from!;
    const length = Math.min(size - start, tail ? LOG_TAIL_BYTES : LOG_CHUNK_BYTES);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = length > 0 ? await handle.read(buffer, 0, length, start) : { bytesRead: 0 };
    let bytes = buffer.subarray(0, bytesRead);
    // A tail starts at a line's beginning, so it never opens in the middle of a line or a character.
    if (tail && start > 0) {
      const newline = bytes.indexOf(0x0a);
      const skip = newline === -1 ? bytes.length : newline + 1;
      bytes = bytes.subarray(skip);
      start += skip;
    }
    // While the log may still grow, a read ends after its last whole line; a newline byte is never part of a multibyte character.
    const finished = preview.attemptState === "ready" || preview.attemptState === "failed";
    const last = bytes.lastIndexOf(0x0a);
    const cut = last !== -1 ? last + 1 : finished || bytes.length === LOG_CHUNK_BYTES ? bytes.length : 0;
    const end = start + cut;
    return { ...empty, start, end, text: cleanLog(bytes.subarray(0, cut).toString("utf8")), truncated: start > 0 && tail, reset, more: end < size };
  } finally {
    await handle.close();
  }
}

/** Matches terminal control sequences, such as colors and cursor movement, that a log shouldn't show as text. */
const CONTROL_SEQUENCES = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

/**
 * Log text as a reader sees it: terminal colors and cursor sequences
 * removed, and a line a progress display rewrote with carriage returns
 * shown as it ended.
 */
export function cleanLog(text: string): string {
  return text
    .replace(CONTROL_SEQUENCES, "")
    .split("\n")
    .map((line) => {
      const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
      const rewritten = trimmed.lastIndexOf("\r");
      return rewritten === -1 ? trimmed : trimmed.slice(rewritten + 1);
    })
    .join("\n");
}
