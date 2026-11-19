/**
 * Parses and canonicalizes repository clone URLs.
 *
 * Only file://, https://, and ssh:// URLs are accepted. scp-style shorthand,
 * transport-command forms (ext::, fd::, and other "helper::address" URLs),
 * unsupported schemes, embedded credentials, option-like hosts and path
 * segments, query strings, fragments, and dot segments are rejected before any
 * value reaches Git.
 *
 * Parsing is done by hand rather than with WHATWG URL, which would silently
 * resolve ".." segments and re-encode paths instead of rejecting them.
 */

const CLONE_URL_SCHEMES = ["file", "https", "ssh"] as const;
export type CloneUrlScheme = (typeof CLONE_URL_SCHEMES)[number];

export type CloneUrlErrorCode =
  | "blank"
  | "malformed"
  | "transport_command"
  | "local_path"
  | "scp_shorthand"
  | "unsupported_scheme"
  | "embedded_credentials"
  | "remote_file_host"
  | "option_injection"
  | "path_traversal"
  | "query_or_fragment";

export class InvalidCloneUrl extends Error {
  override name = "InvalidCloneUrl";

  constructor(
    readonly code: CloneUrlErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_PORTS: Record<string, number> = { https: 443, ssh: 22 };
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const IPV6 = /^\[[0-9a-f:.]+\]$/;
const SSH_USER = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;

export class CloneUrl {
  private constructor(
    readonly scheme: CloneUrlScheme,
    readonly user: string | null,
    readonly host: string | null,
    readonly port: number | null,
    /** Decoded absolute path with single slashes and no trailing slash. */
    readonly path: string,
  ) {}

  static parse(input: string): CloneUrl {
    const raw = input.trim();
    if (!raw) throw invalid("blank", "Enter a clone URL");
    if (/[\x00-\x20\x7f]/.test(raw)) throw invalid("malformed", "Clone URLs cannot contain whitespace or control characters");

    const transport = /^([A-Za-z0-9+.-]+)::/.exec(raw);
    if (transport) throw invalid("transport_command", `The ${transport[1]}:: transport can run arbitrary commands and is not supported`);

    const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(.*)$/.exec(raw);
    if (!match) throw schemeless(raw);

    const scheme = match[1]!.toLowerCase();
    if (!(CLONE_URL_SCHEMES as readonly string[]).includes(scheme)) {
      throw invalid("unsupported_scheme", `The ${scheme}:// transport is not supported; use file://, https://, or ssh://`);
    }
    const rest = match[3]!;
    if (rest.includes("?") || rest.includes("#")) throw invalid("query_or_fragment", "Clone URLs cannot include a query string or fragment");

    const { user, host, port } = parseAuthority(scheme as CloneUrlScheme, match[2]!);
    return new CloneUrl(scheme as CloneUrlScheme, user, host, port, parsePath(rest));
  }

  static isValid(input: string): boolean {
    try {
      CloneUrl.parse(input);
      return true;
    } catch {
      return false;
    }
  }

  /** Builds a file:// URL for a boundary-resolved absolute local path. */
  static forLocalPath(absolutePath: string): CloneUrl {
    return CloneUrl.parse(`file://${encodePath(absolutePath)}`);
  }

  /** A display-safe form of any submitted value, valid or not. */
  static redact(input: string): string {
    return input.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1[REDACTED]@").replace(/[?#].*$/, "");
  }

  get isFile(): boolean {
    return this.scheme === "file";
  }

  get protocol(): CloneUrlScheme {
    return this.scheme;
  }

  /** The decoded local path of a file:// URL. */
  get localPath(): string | null {
    return this.isFile ? this.path : null;
  }

  /** The URL the Frontend Registry stores and hands to Git. */
  toString(): string {
    if (this.isFile) return `file://${encodePath(this.path)}`;
    return `${this.scheme}://${this.user ? `${this.user}@` : ""}${this.host}${this.port ? `:${this.port}` : ""}${encodePath(this.path)}`;
  }

  /**
   * Identity key for duplicate detection. Ignores the SSH user, default ports,
   * host case, a trailing slash, and a trailing ".git" on remote paths.
   */
  get canonical(): string {
    if (this.isFile) return `file://${this.path}`;
    const path = this.path.endsWith(".git") ? this.path.slice(0, -4) : this.path;
    return `${this.scheme}://${this.host}${this.port ? `:${this.port}` : ""}${path}`;
  }

  equals(other: CloneUrl): boolean {
    return this.canonical === other.canonical;
  }
}

function invalid(code: CloneUrlErrorCode, message: string): InvalidCloneUrl {
  return new InvalidCloneUrl(code, message);
}

function schemeless(raw: string): InvalidCloneUrl {
  if (raw.startsWith("/") || raw.startsWith("./") || raw.startsWith("../") || raw.startsWith("~")) {
    return invalid("local_path", "Use a file:// URL for local repositories");
  }
  if (/^(?:[^@/:]+@)?[^/:]+:/.test(raw)) {
    return invalid("scp_shorthand", "scp-style shorthand (host:path) is not supported; use an ssh:// URL");
  }
  return invalid("unsupported_scheme", "Use a file://, https://, or ssh:// clone URL");
}

function parseAuthority(scheme: CloneUrlScheme, authority: string): { user: string | null; host: string | null; port: number | null } {
  const at = authority.lastIndexOf("@");
  const userinfo = at >= 0 ? authority.slice(0, at) : null;
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;

  if (scheme === "file") {
    if (userinfo !== null) throw invalid("malformed", "file:// URLs cannot contain user information");
    if (hostPort !== "" && hostPort.toLowerCase() !== "localhost") throw invalid("remote_file_host", "file:// URLs must refer to a local path");
    return { user: null, host: null, port: null };
  }

  let user: string | null = null;
  if (userinfo !== null) {
    if (scheme === "https") {
      throw invalid("embedded_credentials", "HTTPS clone URLs cannot contain a username, password, or access token; configure a credential helper instead");
    }
    if (userinfo.includes(":")) throw invalid("embedded_credentials", "SSH clone URLs cannot contain a password; use an SSH agent instead");
    const decoded = decode(userinfo);
    if (!SSH_USER.test(decoded)) throw invalid("malformed", "The SSH username is not valid");
    user = decoded;
  }

  const hostMatch = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/.exec(hostPort);
  if (!hostMatch) throw invalid("malformed", "The clone URL must include a valid host");
  const host = hostMatch[1]!.toLowerCase();
  if (host.startsWith("-")) throw invalid("option_injection", "Hosts cannot begin with a dash");
  if (!HOSTNAME.test(host) && !IPV6.test(host)) throw invalid("malformed", "The clone URL must include a valid host");

  let port: number | null = null;
  if (hostMatch[2] !== undefined) {
    const value = Number(hostMatch[2]);
    if (!hostMatch[2] || !Number.isInteger(value) || value < 1 || value > 65_535) throw invalid("malformed", "The clone URL port is not valid");
    port = value === DEFAULT_PORTS[scheme] ? null : value;
  }
  return { user, host, port };
}

function parsePath(rawPath: string): string {
  if (!rawPath.startsWith("/")) throw invalid("malformed", "The clone URL must include a repository path");
  const segments = rawPath.split("/").filter((segment) => segment !== "").map(decode);
  if (segments.length === 0) throw invalid("malformed", "The clone URL must include a repository path");

  for (const segment of segments) {
    if (/[\x00-\x1f\x7f]/.test(segment) || segment.includes("/")) throw invalid("malformed", "The clone URL path contains invalid characters");
    if (segment === "." || segment === "..") throw invalid("path_traversal", "Clone URL paths cannot contain . or .. segments");
    if (segment.startsWith("-")) throw invalid("option_injection", "Clone URL path segments cannot begin with a dash");
  }
  return `/${segments.join("/")}`;
}

function decode(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.isWellFormed()) throw new Error("not well-formed");
    return decoded;
  } catch {
    throw invalid("malformed", "The clone URL contains invalid percent-encoding");
  }
}

/** Percent-encodes each path segment, keeping the characters RFC 3986 allows in a path. */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/%(24|26|2B|2C|3B|3D|3A|40)/gi, (escape) => decodeURIComponent(escape)))
    .join("/");
}
