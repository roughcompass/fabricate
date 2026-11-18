import path from "node:path";
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { LEGACY_REDIRECTS } from "./src/lib/web/redirects";

const root = path.dirname(new URL(import.meta.url).pathname);

const REPO_FACTS_PACKAGES = ["@repo-facts/architecture", "@repo-facts/bundle", "@repo-facts/contract", "@repo-facts/core", "@repo-facts/design-system", "@repo-facts/services", "@repo-facts/syntax"];

/** What Prototypes reads from disk at run time, which tracing can't see (Prototypes design.md, decision 4). */
const PROTOTYPES_RUNTIME_FILES = [
  "src/lib/prototypes/salt/registry/**",
  "src/lib/prototypes/seed/seed.json",
  "src/prototypes/runtime/shell/**",
  "node_modules/typescript/lib/lib.*.d.ts",
  "node_modules/@types/react/**/*.{d.ts,json}",
  "node_modules/@types/react-dom/**/*.{d.ts,json}",
  "node_modules/csstype/**/*.{d.ts,json}",
  "node_modules/@salt-ds/*/package.json",
  "node_modules/@salt-ds/*/dist-types/**",
  "node_modules/date-fns/**/*.{d.ts,d.cts,json}",
  "node_modules/ag-grid-community/package.json",
  "node_modules/ag-grid-community/dist/package.json",
  "node_modules/ag-grid-community/dist/types/**",
  "node_modules/ag-grid-react/package.json",
  "node_modules/ag-grid-react/dist/types/**",
];

const nextConfig: NextConfig = {
  // Browser tests build into their own directory, so they can run beside a
  // developer's `npm run dev` without sharing its dev-server lock or output.
  distDir: process.env.FABRICATE_NEXT_DIST_DIR ?? ".next",
  // The production image runs the standalone server without a package manager; Vercel builds its own functions (Prototypes design.md, decision 4).
  output: process.env.VERCEL ? undefined : "standalone",
  // Files the server reads at run time, which tracing can't see: the committed Salt registry and seed, the page shell's source for the
  // Code view and downloads, and the type declarations the typecheck gate reads. The production image copies config/ itself; on
  // Vercel the settings ship with every function too.
  outputFileTracingIncludes: { "/**": [...PROTOTYPES_RUNTIME_FILES, ...(process.env.VERCEL ? ["config/fabricate.json"] : [])] },
  // Tracing the proxy and instrumentation takes the whole project directory, which Next's excludes don't reach, so deploys
  // are built from a clean copy without local data (docs/prototypes.md, "Hosting on Vercel").
  // Loaded from node_modules, never bundled: the native SQLite binding, and the
  // pinned repo-facts detector release, which ships to the image as its
  // published packages with their provenance. The worker bundle loads the same copy.
  // Prototypes' PGlite loads its WebAssembly Postgres and data files from its
  // package directory, so it is loaded from node_modules too.
  serverExternalPackages: ["better-sqlite3", "@electric-sql/pglite", ...REPO_FACTS_PACKAGES],
  outputFileTracingRoot: root,
  turbopack: { root },
  poweredByHeader: false,
  reactStrictMode: true,
  // The prototype runtime loads into sandboxed frames, whose opaque origin
  // makes every request cross-origin; it is static, public, and addressed by
  // its content hash (design.md, decision 8).
  headers() {
    return Promise.resolve([
      {
        source: "/prototype-runtime/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ]);
  },
  // Addresses the product no longer serves open the pages that replaced them (src/lib/web/redirects.ts).
  redirects() {
    return Promise.resolve(LEGACY_REDIRECTS);
  },
};

// Prototypes runs its generations as Vercel Workflows (Prototypes design.md, decision 5).
export default withWorkflow(nextConfig);
