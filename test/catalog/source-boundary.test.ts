import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BoundaryViolation, type BoundaryViolationCode, SourceBoundary } from "@/lib/catalog/source-boundary";
import { type FrontendRegistryConfig, type Settings, getConfig, loadConfig } from "@/lib/config";
import { GitFixture } from "../support/git-fixture";

describe("local source boundary", () => {
  let fixture: GitFixture;
  let fleet: string;
  let fleetKit: string;
  let config: FrontendRegistryConfig;

  const settings = (overrides: Partial<Settings> = {}): Settings => ({
    ...getConfig().settings,
    allowedRoots: [fleet],
    deniedRoots: [],
    ...overrides,
  });
  const boundary = (overrides: Partial<Settings> = {}) =>
    new SourceBoundary(loadConfig({ appRoot: path.join(fixture.root, "frontend-registry"), environment: "test", env: {}, file: { shared: settings(overrides) } }));
  const violation = (work: () => unknown): BoundaryViolationCode => {
    try {
      work();
    } catch (error) {
      if (error instanceof BoundaryViolation) return error.code;
      throw error;
    }
    throw new Error("expected a BoundaryViolation");
  };

  beforeEach(() => {
    fixture = GitFixture.create("boundary");
    fixture.dir("frontend-registry");
    fleet = fixture.dir("fleet");
    fleetKit = fixture.dir("fleet-kit");
    fixture.repo("fleet/orders").write("README.md", "orders").commit();
    fixture.repo("fleet-kit/answers").write("answers.json", "{}").commit();
    fixture.repo("outside/secret").write("README.md", "secret").commit();
    config = boundary().config;
  });

  afterEach(() => {
    fs.chmodSync(fleetKit, 0o755);
    fixture.cleanup();
  });

  it("accepts an allowed fleet repository and resolves its Git directory", () => {
    const location = boundary().check(path.join(fleet, "orders"));

    expect(location).toEqual({ path: path.join(fleet, "orders"), gitDir: path.join(fleet, "orders", ".git") });
    expect(config.deniedRoots).toContain(fleetKit);
  });

  it("accepts a bare repository", () => {
    const bare = fixture.bare("fleet/mirror.git");
    expect(boundary().check(bare.path)).toEqual({ path: bare.path, gitDir: bare.path });
  });

  it("rejects fleet-kit directly without inspecting it", () => {
    fs.chmodSync(fleetKit, 0o000);

    expect(violation(() => boundary().check(path.join(fleetKit, "answers")))).toBe("denied_root");
    expect(violation(() => boundary({ allowedRoots: [fixture.root] }).check(path.join(fleetKit, "answers")))).toBe("denied_root");
  });

  it("rejects a symbolic link into fleet-kit without inspecting its target", () => {
    fs.symlinkSync(path.join(fleetKit, "answers"), path.join(fleet, "innocent"));
    fs.symlinkSync("../fleet-kit", path.join(fleet, "relative"));
    fs.chmodSync(fleetKit, 0o000);

    expect(violation(() => boundary().check(path.join(fleet, "innocent")))).toBe("denied_root");
    expect(violation(() => boundary().check(path.join(fleet, "relative", "answers")))).toBe("denied_root");
  });

  it("rejects a directory named fleet-kit anywhere, even inside an allowed root", () => {
    fixture.repo("fleet/nested/fleet-kit/copy").commit();
    expect(violation(() => boundary().check(path.join(fleet, "nested", "fleet-kit", "copy")))).toBe("denied_root");
  });

  it("rejects a symbolic link that escapes the allowed roots", () => {
    fs.symlinkSync(path.join(fixture.root, "outside", "secret"), path.join(fleet, "escape"));

    expect(violation(() => boundary().check(path.join(fleet, "escape")))).toBe("outside_allowed_roots");
    expect(violation(() => boundary().check(path.join(fleet, "..", "outside", "secret")))).toBe("outside_allowed_roots");
  });

  it("rejects configured denied roots, including their real location", () => {
    fs.symlinkSync(path.join(fleet, "orders"), path.join(fixture.root, "alias"));

    expect(violation(() => boundary({ deniedRoots: [path.join(fleet, "orders")] }).check(path.join(fleet, "orders")))).toBe("denied_root");
    expect(violation(() => boundary({ deniedRoots: [path.join(fixture.root, "alias")] }).check(path.join(fleet, "orders")))).toBe("denied_root");
  });

  it.each<[string, (root: string) => string, BoundaryViolationCode]>([
    ["a relative path", () => "fleet/orders", "relative_path"],
    ["a nonexistent path", (root) => path.join(root, "fleet", "missing"), "not_found"],
    ["a directory that is not a Git repository", (root) => path.join(root, "fleet", "notes"), "not_a_repository"],
    ["a regular file", (root) => path.join(root, "fleet", "orders", "README.md"), "not_a_directory"],
  ])("rejects %s", (_label, input, code) => {
    fixture.dir("fleet/notes");
    expect(violation(() => boundary().check(input(fixture.root)))).toBe(code);
  });

  it("rejects local sources when no allowed roots are configured", () => {
    expect(violation(() => boundary({ allowedRoots: [] }).check(path.join(fleet, "orders")))).toBe("no_allowed_roots");
  });

  it("rejects a symbolic link loop", () => {
    fs.symlinkSync(path.join(fleet, "loop-b"), path.join(fleet, "loop-a"));
    fs.symlinkSync(path.join(fleet, "loop-a"), path.join(fleet, "loop-b"));

    expect(violation(() => boundary().check(path.join(fleet, "loop-a")))).toBe("symlink_loop");
  });

  it("rejects Git metadata that lives outside the allowed roots", () => {
    const worktree = fixture.dir("fleet/worktree");
    fs.writeFileSync(path.join(worktree, ".git"), `gitdir: ${path.join(fixture.root, "outside", "secret", ".git")}\n`);
    const linked = fixture.dir("fleet/linked");
    fs.symlinkSync(path.join(fleetKit, "answers", ".git"), path.join(linked, ".git"));

    expect(violation(() => boundary().check(worktree))).toBe("git_metadata_outside_allowed_roots");
    expect(violation(() => boundary().check(linked))).toBe("denied_root");
  });

  it("rejects object alternates outside the allowed roots and HTTP alternates", () => {
    const info = path.join(fleet, "orders", ".git", "objects", "info");
    fs.mkdirSync(info, { recursive: true });
    fs.writeFileSync(path.join(info, "alternates"), `${path.join(fixture.root, "outside", "secret", ".git", "objects")}\n`);
    expect(violation(() => boundary().check(path.join(fleet, "orders")))).toBe("git_metadata_outside_allowed_roots");

    fs.rmSync(path.join(info, "alternates"));
    fs.writeFileSync(path.join(info, "http-alternates"), "https://evil.example.com/objects\n");
    expect(violation(() => boundary().check(path.join(fleet, "orders")))).toBe("alternates");
  });

  it("always denies the harness workspace's own fleet-kit tree", () => {
    const real = new SourceBoundary(loadConfig({ appRoot: process.cwd(), environment: "test", env: {}, file: { shared: { ...getConfig().settings, allowedRoots: [".."], deniedRoots: [] } } }));

    expect(violation(() => real.check(path.join(path.dirname(process.cwd()), "fleet-kit", "anything")))).toBe("denied_root");
  });
});
