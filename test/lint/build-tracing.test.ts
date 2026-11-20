import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The web server's production build traces the files its code could read,
 * and a path that joins a setting's directory to a fixed file name, such as
 * a screenshot's `card.webp` in previews.storage, makes Turbopack trace every
 * file in the project that could match: "Dynamic filesystem access causes
 * tracing of the whole project". The add-applications walkthrough found one
 * in the screenshot lookup. Paths into the stored previews are runtime data,
 * so each such join says `turbopackIgnore`, as configuration.ts does. The
 * comment works only leading a call's argument: after `??` inside it, as
 * configuration.ts once had it, Turbopack still traced the whole project.
 */

const ROOTS = ["src/lib/previews", "src/lib/applications", "src/app"];
const JOIN = /path\.(?:join|resolve)\(/g;

/** The text of each `path.join` or `path.resolve` call in +source+, to its closing parenthesis. */
function joins(source: string): string[] {
  const calls: string[] = [];
  for (const match of source.matchAll(JOIN)) {
    let depth = 0;
    let end = match.index;
    for (; end < source.length; end += 1) {
      if (source[end] === "(") depth += 1;
      if (source[end] === ")" && --depth === 0) break;
    }
    calls.push(source.slice(match.index, end + 1));
  }
  return calls;
}

/** True when the call's last argument is a fixed file name: a literal with an extension, or a constant table's entry. */
function endsInFileName(call: string): boolean {
  return /(?:"[^"/.][^"/]*\.[a-z0-9]{1,8}"|[A-Z][A-Z0-9_]{2,}\[[^\]]+\])\s*\)$/.test(call);
}

function sources(root: string): string[] {
  return fs.readdirSync(root, { recursive: true, encoding: "utf8" }).filter((file) => /\.tsx?$/.test(file)).map((file) => path.join(root, file));
}

/** Every `turbopackIgnore` comment in the web server's and worker's sources, with the text just before it. */
function ignores(): { file: string; before: string }[] {
  return sources("src").flatMap((file) => {
    const source = fs.readFileSync(file, "utf8");
    return [...source.matchAll(/\/\*turbopackIgnore: true\*\//g)].map((match) => ({ file, before: source.slice(Math.max(0, match.index - 40), match.index) }));
  });
}

describe("build tracing", () => {
  it("recognizes the join the walkthrough found", () => {
    const before = 'const file = path.join(previewDirectory(config, id), ...screenshot.directory.split("/"), SCREENSHOT_FILES[size]);';
    expect(joins(before).filter(endsInFileName)).toHaveLength(1);
    expect(joins('path.join(root, "screenshot.webp")').filter(endsInFileName)).toHaveLength(1);
    expect(joins('path.join(root, ".trash")').filter(endsInFileName)).toHaveLength(0);
  });

  it("puts each ignore where Turbopack reads it, leading a call's argument, never inside an expression (configuration.ts's app root)", () => {
    const found = ignores();
    expect(found.length).toBeGreaterThan(10);
    expect(found.filter(({ before }) => !/\(\s*$/.test(before)).map(({ file, before }) => `${file}: …${before.trim()}`)).toEqual([]);
  });

  it("leaves paths to stored files out of the web server's build", () => {
    const unmarked = ROOTS.flatMap(sources).flatMap((file) =>
      joins(fs.readFileSync(file, "utf8"))
        .filter((call) => endsInFileName(call) && !call.includes("turbopackIgnore"))
        .map((call) => `${file}: ${call}`),
    );
    expect(unmarked).toEqual([]);
  });
});
