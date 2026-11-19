import fs from "node:fs/promises";
import path from "node:path";
import type { BuildTool } from "./eligibility";

/**
 * Finds a preview build's output and decides whether it can be published
 * (design decision 4, step 5). The build's one output directory comes from a
 * directory its tool's configuration names literally, or else the `dist` or
 * `build` convention, whichever the build wrote into; several or none is an
 * error, never a guess. The output must hold only directories and regular
 * files within its boundary, stay under the size limit, and contain
 * `index.html`, the page that loads the application on its own. A
 * microfrontend is previewed through the page its own build emits, like any
 * other application (design decision 7), so a bundle without one isn't
 * published.
 */

/** Why a build's output can't be published. */
export class OutputError extends Error {
  override name = "OutputError";
}

/** The page every published artifact serves at its root, and falls back to for navigation. */
export const PAGE = "index.html";

/** The entry metadata stored with a published artifact (preview_builds.artifact_entry), for serving. */
export type ArtifactEntry = {
  /** The artifact's page, relative to it: always index.html. */
  file: typeof PAGE;
  /** Whether that page refers to assets at the site root outside the preview's base path, so serving must rebase it. */
  rebase: boolean;
};

export interface ValidatedOutput {
  files: number;
  bytes: number;
  entry: ArtifactEntry;
}

const CONVENTIONAL = ["dist", "build"];

/** Configuration files whose literal output directory a tool honors, and how each names it. */
const LITERAL_CONFIG: Readonly<Record<BuildTool, { files: RegExp; outDir: RegExp }>> = {
  vite: { files: /^vite\.config\.[cm]?[jt]s$/, outDir: /\boutDir\s*:\s*(["'])([^"'\n]+)\1/g },
  rsbuild: { files: /^rsbuild\.config\.[cm]?[jt]s$/, outDir: /\bdistPath\s*:\s*\{[^{}]*?\broot\s*:\s*(["'])([^"'\n]+)\1/g },
  webpack: { files: /^webpack\.config\.[cm]?[jt]s$/, outDir: /\bpath\s*:\s*(?:path\.)?(?:resolve|join)\(\s*__dirname\s*,\s*(["'])([^"'\n]+)\1\s*\)/g },
  rspack: { files: /^rspack\.config\.[cm]?[jt]s$/, outDir: /\bpath\s*:\s*(?:path\.)?(?:resolve|join)\(\s*__dirname\s*,\s*(["'])([^"'\n]+)\1\s*\)/g },
};

/**
 * The build's output directory, relative to +packageDir+: the one its tool's
 * configuration names literally when the build wrote into it, or else
 * whichever of `dist` and `build` the build wrote files into since +since+.
 */
export async function findOutputDirectory(packageDir: string, tool: BuildTool, since: number): Promise<string> {
  const literal = await literalOutDir(packageDir, tool);
  const names = [...new Set([...(literal ? [literal] : []), ...CONVENTIONAL])];
  const written: string[] = [];
  for (const name of names) if (await wroteInto(path.join(packageDir, name), name, since)) written.push(name);
  if (literal && written.includes(literal)) return literal;
  if (written.length === 1) return written[0]!;
  if (written.length === 0) throw new OutputError(`The build wrote no output into ${list(names, "or")}.`);
  throw new OutputError(`The build wrote output into ${list(written, "and")}, so which one to publish can't be decided.`);
}

/**
 * Checks the output at +root+ and records its page. Throws OutputError for a
 * symbolic link or other special file, output over +maxBytes+, or output
 * without index.html.
 */
export async function validateOutput(root: string, options: { base: string; maxBytes: number }): Promise<ValidatedOutput> {
  const stat = await fs.lstat(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new OutputError("The output directory is a symbolic link or not a directory. Previews publish only regular files.");
  const { files, bytes } = await inventory(root, options.maxBytes);
  if (!files.includes(PAGE)) throw new OutputError(`The output has no ${PAGE}. Previews need a page that loads the application on its own.`);
  const rebase = rootRelative(await fs.readFile(path.join(root, PAGE), "utf8"), options.base);
  return { files: files.length, bytes, entry: { file: PAGE, rebase } };
}

// -- Output directory ---------------------------------------------------------------

/** The output directory the tool's configuration names literally, when exactly one is named and it stays inside the package. */
async function literalOutDir(packageDir: string, tool: BuildTool): Promise<string | null> {
  const { files, outDir } = LITERAL_CONFIG[tool];
  const named = new Set<string>();
  for (const entry of await fs.readdir(packageDir, { withFileTypes: true })) {
    if (!entry.isFile() || !files.test(entry.name)) continue;
    const text = await fs.readFile(path.join(packageDir, entry.name), "utf8");
    for (const match of text.matchAll(outDir)) named.add(match[2]!);
  }
  if (named.size !== 1) return null;
  const relative = path.posix.normalize([...named][0]!.replace(/^\.\//, "").replace(/\/+$/, ""));
  return relative === "." || relative.startsWith("..") || path.posix.isAbsolute(relative) ? null : relative;
}

/** Whether the build wrote a regular file into +directory+ since +since+. A symbolic link there is never output. */
async function wroteInto(directory: string, name: string, since: number): Promise<boolean> {
  const stat = await fs.lstat(directory).catch(() => null);
  if (!stat) return false;
  if (stat.isSymbolicLink()) throw new OutputError(`The output directory ${name} is a symbolic link. Previews publish only regular files.`);
  if (!stat.isDirectory()) return false;
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && (await fs.lstat(full)).mtimeMs >= since) return true;
    }
  }
  return false;
}

// -- Validation -------------------------------------------------------------------

/** Every regular file under +root+, as relative paths, and their total size; anything else is an error. */
async function inventory(root: string, maxBytes: number): Promise<{ files: string[]; bytes: number }> {
  const files: string[] = [];
  let bytes = 0;
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new OutputError(`The output contains a symbolic link, ${relative}. Previews publish only regular files.`);
      if (entry.isDirectory()) {
        await walk(full, relative);
      } else if (entry.isFile()) {
        bytes += (await fs.lstat(full)).size;
        if (bytes > maxBytes) throw new OutputError(`The output is larger than ${formatBytes(maxBytes)}, the limit previews.maxOutputBytes sets.`);
        files.push(relative);
      } else {
        throw new OutputError(`The output contains ${relative}, which isn't a regular file. Previews publish only regular files.`);
      }
    }
  };
  await walk(root, "");
  return { files, bytes };
}

/** Whether +html+ refers to anything at the site root outside +base+, such as `/assets/app.js`. */
function rootRelative(html: string, base: string): boolean {
  for (const match of html.matchAll(/\s(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (value.startsWith("/") && !value.startsWith("//") && !(value.startsWith(base) || value === base.slice(0, -1))) return true;
  }
  return false;
}

// -- Helpers ----------------------------------------------------------------------

/** A size as the logs and reasons state it: 64 bytes, 1.5 KiB, 200 MiB. */
export function formatBytes(bytes: number): string {
  for (const [unit, size] of [
    ["GiB", 1024 ** 3],
    ["MiB", 1024 ** 2],
    ["KiB", 1024],
  ] as const) {
    if (bytes >= size) return `${Number((bytes / size).toFixed(1))} ${unit}`;
  }
  return `${bytes} bytes`;
}

function list(items: readonly string[], conjunction: "and" | "or"): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items.at(-1)}`;
}
