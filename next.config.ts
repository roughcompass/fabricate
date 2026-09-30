import path from "node:path";
import type { NextConfig } from "next";

const root = path.dirname(new URL(import.meta.url).pathname);

const nextConfig: NextConfig = {
  // Browser tests build into their own directory, so they can run beside a
  // developer's `npm run dev` without sharing its dev-server lock or output.
  distDir: process.env.FABRICATE_NEXT_DIST_DIR ?? ".next",
  // The production image runs the standalone server without a package manager.
  output: "standalone",
  // Native SQLite binding is loaded from node_modules, never bundled.
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingRoot: root,
  turbopack: { root },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
