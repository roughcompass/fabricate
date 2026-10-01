import path from "node:path";
import type { NextConfig } from "next";

const root = path.dirname(new URL(import.meta.url).pathname);

const REPO_FACTS_PACKAGES = ["@repo-facts/architecture", "@repo-facts/bundle", "@repo-facts/contract", "@repo-facts/core", "@repo-facts/services", "@repo-facts/syntax"];

const nextConfig: NextConfig = {
  // Browser tests build into their own directory, so they can run beside a
  // developer's `npm run dev` without sharing its dev-server lock or output.
  distDir: process.env.FABRICATE_NEXT_DIST_DIR ?? ".next",
  // The production image runs the standalone server without a package manager.
  output: "standalone",
  // Loaded from node_modules, never bundled: the native SQLite binding, and the
  // pinned repo-facts detector release, which ships to the image as its
  // published packages with their provenance. The worker bundle loads the same copy.
  serverExternalPackages: ["better-sqlite3", ...REPO_FACTS_PACKAGES],
  outputFileTracingRoot: root,
  turbopack: { root },
  poweredByHeader: false,
  reactStrictMode: true,
  // Addresses from before the interface vocabulary changed (page-patterns
  // spec, "Every link opens the page it names"). Old Assessment pages are
  // told apart from the new ones by their public ID prefix: a model
  // Assessment (asm_) is now a Run, while /assessments/ini_… is an Assessment.
  redirects() {
    return [
      { source: "/initiatives/new", destination: "/assessments/new", permanent: true },
      { source: "/initiatives/:id(ini_[a-z0-9]{16})/:rest*", destination: "/assessments/:id/:rest*", permanent: true },
      { source: "/assessments/:id(asm_[a-z0-9]{16})/:rest*", destination: "/runs/:id/:rest*", permanent: true },
      { source: "/sources/:rest*", destination: "/repositories/:rest*", permanent: true },
      // The BitBucket import moved under Applications; Next passes the old query through, which the form ignores.
      {
        source: "/new/import",
        has: [
          { type: "query", key: "project", value: "(?<project>[A-Z][A-Z0-9]{1,9})" },
          { type: "query", key: "repository", value: "(?<repository>[a-z][a-z0-9-]*)" },
        ],
        destination: "/applications/import/:project/:repository",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
