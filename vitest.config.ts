import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  resolve: {
    alias: { "@": path.join(root, "src") },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    pool: "forks",
    setupFiles: ["test/setup.ts"],
    testTimeout: 20_000,
  },
});
