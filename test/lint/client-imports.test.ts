import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * What a client component imports ships to the browser, and so does
 * everything those modules import in turn. A browser bundle can't load a
 * Node built-in such as node:crypto, or a package that runs only on the
 * server, and webpack refuses the build when one is reached. This walks the
 * value imports of every "use client" module, skipping type-only imports,
 * which leave no trace in the bundle, and fails with the chain that reaches
 * Node-only code.
 */

const SRC = path.resolve("src");
const BUILTINS = new Set(builtinModules);
/** Packages that run only on the server (next.config.ts lists them as server externals). */
const SERVER_ONLY = [/^better-sqlite3$/, /^@repo-facts\//, /^drizzle-orm\/better-sqlite3/];

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

const isClient = (source: string) => /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(source);

/** The modules a file imports or re-exports for their values; `import type` and all-`type` specifier lists are left out. */
function valueImports(source: string): string[] {
  const found: string[] = [];
  const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g;
  for (let match = statement.exec(source); match; match = statement.exec(source)) {
    const [, , typeOnly, clause = "", specifier = ""] = match;
    if (typeOnly) continue;
    const named = /\{([^}]*)\}/.exec(clause);
    const bare = clause.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
    const allTypes = named !== null && !bare && named[1]!.split(",").map((item) => item.trim()).filter(Boolean).every((item) => item.startsWith("type "));
    if (!allTypes) found.push(specifier);
  }
  for (const match of source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) found.push(match[1]!);
  return found;
}

function resolveLocal(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? path.join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const nodeOnly = (specifier: string) => specifier.startsWith("node:") || BUILTINS.has(specifier) || SERVER_ONLY.some((pattern) => pattern.test(specifier));

/** The import chain from +file+ to Node-only code, or null when its imports are all safe for the browser. */
function nodeChain(file: string, seen: Set<string>): string[] | null {
  if (seen.has(file)) return null;
  seen.add(file);
  const source = fs.readFileSync(file, "utf8");
  for (const specifier of valueImports(source)) {
    if (nodeOnly(specifier)) return [path.relative(SRC, file), specifier];
    const local = resolveLocal(file, specifier);
    if (!local || local.endsWith(".css")) continue;
    const chain = nodeChain(local, seen);
    if (chain) return [path.relative(SRC, file), ...chain];
  }
  return null;
}

describe("client components", () => {
  it("reads value imports and leaves type-only ones out", () => {
    expect(valueImports(`import type { A } from "./a";\nimport { type B, type C } from "./b";\nimport { D, type E } from "./d";\nimport F from "./f";\nexport { G } from "./g";\nexport type { H } from "./h";\nimport "./side-effect";`)).toEqual(["./d", "./f", "./g", "./side-effect"]);
  });

  it("import nothing that reaches a Node built-in or a server-only package", () => {
    const clients = sourceFiles(SRC).filter((file) => isClient(fs.readFileSync(file, "utf8")));
    expect(clients.length).toBeGreaterThan(20);
    const reached = clients.map((file) => nodeChain(file, new Set())).filter((chain): chain is string[] => chain !== null).map((chain) => chain.join(" → "));
    expect(reached).toEqual([]);
  });
});
