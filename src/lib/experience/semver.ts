/*
 * The small part of semantic versioning the experience editor needs, with no
 * dependency: comparing versions, and resolving a range to the highest
 * published version it matches. Ranges are an exact version, ^, ~, >=, <,
 * an x-range such as 2.x or 1.4.x, or * for any version. A prerelease
 * matches only a range that names it exactly. Shared by the editor's client
 * code and the server, so it imports nothing.
 */

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function isVersion(value: string): boolean {
  return VERSION.test(value);
}

type Parsed = { major: number; minor: number; patch: number; pre: string | null };

function parseVersion(value: string): Parsed | null {
  const match = VERSION.exec(value);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ?? null } : null;
}

/** Negative when +a+ is older than +b+, positive when newer, 0 when equal; a prerelease is older than its release. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  if (!x || !y) return a.localeCompare(b);
  if (x.major !== y.major) return x.major - y.major;
  if (x.minor !== y.minor) return x.minor - y.minor;
  if (x.patch !== y.patch) return x.patch - y.patch;
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre.localeCompare(y.pre);
}

type Predicate = (version: Parsed, raw: string) => boolean;

/** The test a range applies, or null when +range+ isn't one this module understands. */
function rangeTest(range: string): Predicate | null {
  const value = range.trim();
  if (value === "*" || value === "x" || value === "latest") return (version) => version.pre === null;
  const xRange = /^(\d+)(?:\.(\d+|x|\*))?(?:\.(x|\*))?$/.exec(value);
  if (xRange && (xRange[2] === undefined || xRange[2] === "x" || xRange[2] === "*" || xRange[3] !== undefined)) {
    const major = Number(xRange[1]);
    const minor = xRange[2] === undefined || xRange[2] === "x" || xRange[2] === "*" ? null : Number(xRange[2]);
    return (version) => version.pre === null && version.major === major && (minor === null || version.minor === minor);
  }
  const operator = /^(\^|~|>=|<=|>|<|=)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(value);
  if (!operator) return null;
  const base = parseVersion(operator[2]!)!;
  const raw = operator[2]!;
  const releaseOnly = (test: Predicate): Predicate => (version, text) => (version.pre === null || text === raw) && test(version, text);
  switch (operator[1]) {
    case undefined:
    case "=":
      return (_version, text) => text === raw;
    case "^":
      return releaseOnly((version, text) => compareVersions(text, raw) >= 0 && (base.major > 0 ? version.major === base.major : base.minor > 0 ? version.major === 0 && version.minor === base.minor : version.major === 0 && version.minor === 0 && version.patch === base.patch));
    case "~":
      return releaseOnly((version, text) => compareVersions(text, raw) >= 0 && version.major === base.major && version.minor === base.minor);
    case ">=":
      return releaseOnly((_version, text) => compareVersions(text, raw) >= 0);
    case ">":
      return releaseOnly((_version, text) => compareVersions(text, raw) > 0);
    case "<=":
      return releaseOnly((_version, text) => compareVersions(text, raw) <= 0);
    case "<":
      return releaseOnly((_version, text) => compareVersions(text, raw) < 0);
    default:
      return null;
  }
}

export function isRange(range: string): boolean {
  return rangeTest(range) !== null;
}

/** The highest of +versions+ that +range+ matches, or null when it matches none or isn't a range. */
export function resolveRange(versions: readonly string[], range: string): string | null {
  const test = rangeTest(range);
  if (!test) return null;
  const matches = versions.filter((raw) => {
    const parsed = parseVersion(raw);
    return parsed !== null && test(parsed, raw);
  });
  return matches.sort((a, b) => compareVersions(b, a))[0] ?? null;
}
