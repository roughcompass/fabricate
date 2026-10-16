import fs from "node:fs";
import path from "node:path";

/**
 * The page shell's source, shown in a page version's Code view and included
 * in downloads unchanged (design.md, decision 9). It is read from the file
 * the frame's runtime is built from, so the two never differ.
 */

const SHELL_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "src", "prototypes", "runtime", "shell");

let cached: { readonly tsx: string; readonly css: string } | null = null;

export function shellSource(): { readonly tsx: string; readonly css: string } {
  cached ??= { tsx: fs.readFileSync(path.join(SHELL_DIR, "page-shell.tsx"), "utf8"), css: fs.readFileSync(path.join(SHELL_DIR, "page-shell.css"), "utf8") };
  return cached;
}
