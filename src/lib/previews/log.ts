import fsp from "node:fs/promises";
import path from "node:path";
import type { FrontendRegistryConfig } from "@/lib/config";
import { redactSecrets } from "@/lib/git/redact";
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
    // Redacted as it's read, so a log written before its build redacted its output shows no credential either.
    return { ...empty, start, end, text: redactSecrets(cleanLog(bytes.subarray(0, cut).toString("utf8"))), truncated: start > 0 && tail, reset, more: end < size };
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

// -- A failed build's excerpt -------------------------------------------------------

/** How many lines of a failed build's output its reason shows, and how many characters of each. */
const EXCERPT_LINES = 8;
const EXCERPT_WIDTH = 240;
/** A line that says what went wrong. */
const PROBLEM = /\b(?:errors?|ERR!|failed|failure|cannot|can't|could not|couldn't|not found|exception|fatal)\b/i;
/** Lines that don't help a reader: blank lines, stack frames, package managers' pointers to documentation or to their own logs, and npm's restatement of the command that failed. */
const NOISE = [/^\s*$/, /^\s+at\s/, /^info Visit https?:\/\//, /^npm (?:ERR!|error) A complete log of this run can be found in/, /^npm (?:ERR!|error)\s+\S+\.log$/, /^npm (?:ERR!|error) (?:code|path|workspace|location|command)\b/];

/**
 * The last meaningful lines of a failed build's log +text+, as an
 * application shows them beside the failure's reason: the output of the step
 * that failed, without blank lines, stack frames, or pointers to other logs;
 * its last lines, or, when a problem is named earlier than they start, the
 * line before the first that names one and those after it; with +strip+, the
 * build's own directories, removed from paths; at most EXCERPT_LINES lines of
 * EXCERPT_WIDTH characters; and redacted as Git diagnostics and failure
 * reasons are. Empty when the failing step wrote nothing, as when the build
 * stopped before running a command.
 */
export function logExcerpt(text: string, options: { strip?: readonly string[] } = {}): string[] {
  const lines = cleanLog(text).split("\n");
  const failed = lines.findLastIndex((line) => line.startsWith("==> failed:"));
  const end = failed === -1 ? lines.length : failed;
  const start = lines.slice(0, end).findLastIndex((line) => line.startsWith("==> ")) + 1;
  const prefixes = [...(options.strip ?? [])].filter(Boolean).sort((a, b) => b.length - a.length);
  const output = lines
    .slice(start, end)
    .map((line) => prefixes.reduce((stripped, prefix) => stripped.replaceAll(`file://${prefix}/`, "").replaceAll(`${prefix}/`, ""), line))
    .filter((line) => !NOISE.some((pattern) => pattern.test(line)));
  const first = output.findIndex((line) => PROBLEM.test(line));
  const tail = Math.max(0, output.length - EXCERPT_LINES);
  const from = first === -1 ? tail : Math.max(0, Math.min(first - 1, tail));
  return output.slice(from, from + EXCERPT_LINES).map((line) => {
    const redacted = redactSecrets(line);
    return (redacted.length > EXCERPT_WIDTH ? `${redacted.slice(0, EXCERPT_WIDTH - 1)}…` : redacted).trimEnd();
  });
}

/** The end of the log at +file+, at most LOG_TAIL_BYTES from a line's start, or an empty string when it can't be read. */
export async function readLogTail(file: string): Promise<string> {
  const handle = await fsp.open(file, "r").catch(() => null);
  if (!handle) return "";
  try {
    const size = (await handle.stat()).size;
    const start = Math.max(0, size - LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const bytes = buffer.subarray(0, bytesRead);
    const newline = start > 0 ? bytes.indexOf(0x0a) : -1;
    return bytes.subarray(newline + 1).toString("utf8");
  } finally {
    await handle.close();
  }
}
