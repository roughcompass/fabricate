import { exempt, saltOnlyGate } from "../gates";
import { plantedExemptions } from "./planted";

/**
 * The design-token check for generated hero source (converge-templates-and-
 * prototypes, design decision 11): a generated file may use only Salt's
 * tokens, as the Salt-only gate enforces with `@deweb/portal` allowed, and
 * every `--salt-` token it names must be one Salt's theme defines. A planted
 * version is exempt only from its own planted rules.
 */

const SALT_TOKEN = /var\(\s*(--salt-[a-z0-9-]+)/gi;

/** Every problem with one generated file; none means it passes. */
export function generatedFileProblems(code: string, planted: readonly string[], saltTokens: ReadonlySet<string>): string[] {
  // Members import their hero's data from one directory up; the gates know it as ./data.
  const result = exempt(saltOnlyGate({ code: code.replace(/(from\s+["'])\.\.\/data(["'])/g, "$1./data$2"), data: "export {};\n", portal: true }), plantedExemptions(planted));
  const unknown = [...new Set([...code.matchAll(SALT_TOKEN)].map((match) => match[1]!))].filter((token) => !saltTokens.has(token));
  return [...result.issues.map((issue) => issue.message), ...unknown.map((token) => `${token} isn't a token Salt's theme defines.`)];
}
