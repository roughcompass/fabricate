import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FLEET_ENV, FLEET_ROOT } from "../../e2e/fleet/env";
import { PROTECTED_DIRECTORY, loadConfig } from "@/lib/config";

/**
 * Fabricate never refers to the harness fleet-kit/ data. Its source, scripts,
 * and configuration, including the synthetic-fleet run's settings, name the
 * protected directory only to deny it; none points at anything inside it.
 * (Unit tests create their own throwaway fleet-kit directories to prove the
 * denial and are not part of this check.)
 */

const ROOT = path.resolve(__dirname, "../..");
const BINARY = /\.(png|jpe?g|gif|ico|webp|woff2?|sqlite3?)$/i;
const INTO_PROTECTED = new RegExp(`${PROTECTED_DIRECTORY}[\\\\/][A-Za-z0-9_]`);

const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((file) => fs.existsSync(path.join(ROOT, file)) && !BINARY.test(file));

describe("fleet-kit isolation", () => {
  it("names no path inside fleet-kit/ in source, scripts, or configuration", () => {
    const product = tracked.filter((file) => !file.startsWith("test/") && !(file.startsWith("e2e/") && !file.startsWith("e2e/fleet/")));
    expect(product.length).toBeGreaterThan(50);
    // Control: the pattern recognizes a path into the tree, and not a mention of the tree itself.
    expect(["../fleet-kit/answers.json", "/opt/fleet-kit/data"].every((text) => INTO_PROTECTED.test(text))).toBe(true);
    expect(["the fleet-kit/ tree", 'PROTECTED_DIRECTORY = "fleet-kit"'].some((text) => INTO_PROTECTED.test(text))).toBe(false);
    expect(product.filter((file) => INTO_PROTECTED.test(fs.readFileSync(path.join(ROOT, file), "utf8")))).toEqual([]);
  });

  it.skipIf(!fs.existsSync(FLEET_ROOT))("runs the synthetic fleet with fleet/ as the only allowed root and fleet-kit/ still denied", () => {
    const config = loadConfig({ env: { ...process.env, ...FLEET_ENV } });
    expect(config.allowedRoots).toEqual([fs.realpathSync(FLEET_ROOT)]);
    expect(config.deniedRoots.some((root) => path.basename(root) === PROTECTED_DIRECTORY)).toBe(true);
    expect(Object.values(FLEET_ENV).some((value) => value.includes(PROTECTED_DIRECTORY))).toBe(false);
  });
});
