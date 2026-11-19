import path from "node:path";
import type { NextConfig } from "next";
import { LEGACY_REDIRECTS } from "./src/lib/web/redirects";

const root = path.dirname(new URL(import.meta.url).pathname);

const REPO_FACTS_PACKAGES = ["@repo-facts/architecture", "@repo-facts/bundle", "@repo-facts/contract", "@repo-facts/core", "@repo-facts/design-system", "@repo-facts/services", "@repo-facts/syntax"];

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
  // A repository preview's root is /previews/<id>/, with its slash, so its page's
  // relative references and a router based at that path resolve inside it.
  // src/proxy.ts removes a trailing slash from every other path, as Next.js
  // would; links never end in one (runPath in src/lib/demo/catalog).
  skipTrailingSlashRedirect: true,
  // Addresses the product no longer serves open the pages that replaced them (src/lib/web/redirects.ts).
  redirects() {
    return Promise.resolve(LEGACY_REDIRECTS);
  },
};

export default nextConfig;
