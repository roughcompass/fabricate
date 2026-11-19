import path from "node:path";
import { list } from "./wording";

/*
 * A Vite package's page, which preparation reads through the snapshot reader:
 * Vite builds no page without index.html at the root its build reads.
 */

/** The page a preview opens, which Vite builds from and every build must emit. */
export const PAGE_FILE = "index.html";
/** The configuration files Vite loads from a package's directory, in the order it looks for them. */
const VITE_CONFIGS = ["vite.config.js", "vite.config.mjs", "vite.config.ts", "vite.config.cjs", "vite.config.mts", "vite.config.cts"];
/** A `root` key, quoted or not, as an object literal names it. */
const ROOT_KEY = /(?<![\w$.])(["']?)root\1\s*:\s*/g;
/** A root named literally: a string, `__dirname` or `process.cwd()`, or `path.resolve` or `path.join` of `__dirname` and a string. */
const LITERAL_ROOTS = [/^(["'`])([^"'`$\n]*)\1/, /^(?:__dirname|process\.cwd\(\))(?![\w$.])()()/, /^(?:path\.)?(?:resolve|join)\(\s*__dirname\s*(?:,\s*(["'`])([^"'`$\n]*)\1\s*)?\)/];

/** A Vite package's page, as preparation found it in the commit. */
export type PageRead = { state: "found" | "missing"; page: string; config: string | null } | { state: "undecided"; config: string; reason: string };

/** What preparation can tell about the commit's files: whether a path is committed, and a file's text; null when it can't be read. */
export interface CommittedFiles {
  has(file: string): boolean;
  text(file: string): string | null;
}

/** The configuration Vite loads from +directory+: the first of its default names that's committed, if any. */
export function viteConfig(directory: string, files: Pick<CommittedFiles, "has">): string | null {
  return VITE_CONFIGS.map((name) => (directory === "." ? name : `${directory}/${name}`)).find((file) => files.has(file)) ?? null;
}

/**
 * Where Vite in +directory+ reads its page, and whether it's committed:
 * index.html in the package's directory, or in the root its configuration
 * names literally. A root set in code, or several, can't be decided.
 */
export function readPage(directory: string, files: CommittedFiles): PageRead {
  const config = viteConfig(directory, files);
  let root = ".";
  if (config !== null) {
    const text = files.text(config);
    if (text === null) return { state: "undecided", config, reason: `${config} couldn't be read` };
    const roots = new Set<string>();
    for (const match of text.matchAll(ROOT_KEY)) {
      const value = text.slice(match.index + match[0].length, match.index + match[0].length + 300);
      const literal = LITERAL_ROOTS.map((pattern) => pattern.exec(value)).find((found) => found !== null);
      if (!literal) return { state: "undecided", config, reason: `${config} sets Vite's root in code, so where its page is can't be read` };
      roots.add(path.posix.normalize(literal[2] || "."));
    }
    if (roots.size > 1) return { state: "undecided", config, reason: `${config} names several roots, ${list([...roots])}, so which one Vite reads can't be decided` };
    root = [...roots][0] ?? ".";
  }
  const page = path.posix.normalize(path.posix.join(directory, root, PAGE_FILE));
  if (path.posix.isAbsolute(root) || page.startsWith("../")) return { state: "undecided", config: config!, reason: `${config} names a root outside the repository` };
  return { state: files.has(page) ? "found" : "missing", page, config: root === "." ? null : config };
}
