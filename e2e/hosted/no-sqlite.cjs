/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload, loaded with node --require */
// Preloaded into the hosted-profile server (playwright.hosted.config.ts): loading the native SQLite binding throws, as a
// macOS-built binary would on Vercel's Linux, so any hosted page that loads it fails the run.
const Module = require("node:module");
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "better-sqlite3" || request.endsWith("better_sqlite3.node")) throw new Error("The hosted profile loaded better-sqlite3");
  return load.call(this, request, ...rest);
};
