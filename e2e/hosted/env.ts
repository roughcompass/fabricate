import path from "node:path";

/** The hosted-profile run (npm run test:hosted): Prototypes only, with no Git on the path and no SQLite database. */
export const HOSTED_PORT = Number(process.env.HOSTED_PORT ?? 3300);
export const HOSTED_ROOT = path.resolve("tmp/hosted");

/** Only Node's own directory and /bin, which has no git, so the server can't find a Git binary. */
export const HOSTED_PATH = [path.dirname(process.execPath), "/bin"].join(path.delimiter);

export const HOSTED_ENV = {
  PATH: HOSTED_PATH,
  // Loading the native SQLite binding throws in this server, as a macOS-built binary would on Vercel.
  NODE_OPTIONS: `--require ${path.resolve("e2e/hosted/no-sqlite.cjs")}`,
  FABRICATE_PROFILE: "hosted",
  FABRICATE_PROTOTYPES: "true",
  FABRICATE_DEMO: "false",
  FABRICATE_NEXT_DIST_DIR: ".next-hosted",
  FABRICATE_PROTOTYPES_DATABASE: path.join(HOSTED_ROOT, "prototypes-pglite"),
  // A directory that doesn't exist, so opening SQLite would fail the run.
  FABRICATE_DATABASE: path.join(HOSTED_ROOT, "no-sqlite", "fabricate.sqlite3"),
  FABRICATE_PROTOTYPES_MODEL_GENERATE: "mock",
  FABRICATE_PROTOTYPES_MODEL_PLAN: "mock",
  FABRICATE_PROTOTYPES_MODEL_REVIEW: "mock",
  FABRICATE_PROTOTYPES_MODEL_LEARN: "mock",
};
