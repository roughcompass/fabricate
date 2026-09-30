import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Proves the lint rules that keep application code from executing, loading,
// or evaluating data (design.md, decision 6) stay in force.
const eslint = new ESLint();
const PROFILE_SCHEMA = "src/lib/profiles/schema.ts";

async function violations(code: string, filePath = "src/lib/example.ts") {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => `${message.line}:${message.ruleId}`);
}

describe("safety lint rules", () => {
  it.each([
    ["eval", "export const run = (code: string) => eval(code);", "no-eval"],
    ["the Function constructor", "export const run = (code: string) => new Function(code);", "no-new-func"],
    ["the vm module", 'import vm from "node:vm";\nexport default vm;', "no-restricted-imports"],
    ["createRequire", 'import { createRequire } from "node:module";\nexport default createRequire;', "no-restricted-imports"],
    ["child_process", 'import { spawn } from "node:child_process";\nexport default spawn;', "no-restricted-imports"],
    ["a computed import()", "export const load = (name: string) => import(name);", "no-restricted-syntax"],
    ["a literal import() of an execution module", 'export const load = () => import("node:vm");', "no-restricted-syntax"],
    ["require()", 'export const fs = require("node:fs");', "no-restricted-syntax"],
    ["a RegExp built from data", "export const match = (pattern: string) => new RegExp(pattern);", "no-restricted-syntax"],
    ["a RegExp called with data", "export const match = (pattern: string) => RegExp(pattern);", "no-restricted-syntax"],
    ["the Edge runtime", 'export const runtime = "edge";', "no-restricted-syntax"],
  ])("rejects %s", async (_name, code, rule) => {
    expect(await violations(code)).toContainEqual(expect.stringContaining(rule));
  });

  it("allows literal regular expressions and static imports", async () => {
    const code = 'import path from "node:path";\nexport const pattern = new RegExp("^[a-z]+$");\nexport default path;';
    expect(await violations(code)).toEqual([]);
  });

  it.each([
    ["the network", 'import https from "node:https";\nexport default https;', "no-restricted-imports"],
    ["the filesystem", 'import fs from "node:fs";\nexport default fs;', "no-restricted-imports"],
    ["Git", 'import { GitRunner } from "@/lib/git/runner";\nexport default GitRunner;', "no-restricted-imports"],
    ["the database", 'import { getDb } from "@/lib/db/client";\nexport default getDb;', "no-restricted-imports"],
    ["configuration", 'import { getConfig } from "@/lib/config";\nexport default getConfig;', "no-restricted-imports"],
    ["fetch", 'export const call = () => fetch("https://example.invalid");', "no-restricted-globals"],
    ["WebSocket", 'export const open = () => new WebSocket("wss://example.invalid");', "no-restricted-globals"],
    ["the process environment", "export const token = () => process.env.TOKEN;", "no-restricted-globals"],
  ])("keeps Profile document validation away from %s", async (_name, code, rule) => {
    expect(await violations(code, PROFILE_SCHEMA)).toContainEqual(expect.stringContaining(rule));
  });

  it("lets Profile document validation name types from isolated modules", async () => {
    expect(await violations('import type { FabricateConfig } from "@/lib/config";\nexport type Limits = FabricateConfig["analysis"];', PROFILE_SCHEMA)).toEqual([]);
  });

  it("still applies the execution rules to Profile document validation", async () => {
    expect(await violations("export const run = (code: string) => eval(code);", PROFILE_SCHEMA)).toContainEqual(expect.stringContaining("no-eval"));
    expect(await violations('import { spawn } from "node:child_process";\nexport default spawn;', PROFILE_SCHEMA)).toContainEqual(
      expect.stringContaining("no-restricted-imports"),
    );
  });

  it("allows child_process only in GitRunner", async () => {
    const code = 'import { spawn } from "node:child_process";\nexport default spawn;';
    expect(await violations(code, "src/lib/git/runner.ts")).toEqual([]);
    expect(await violations('import vm from "node:vm";\nexport default vm;', "src/lib/git/runner.ts")).toContainEqual(
      expect.stringContaining("no-restricted-imports"),
    );
  });
});
