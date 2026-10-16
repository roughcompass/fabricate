import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STARTERS_FILE, readStarters, starters } from "@/lib/applications/starters";

/*
 * The starters file (make-applications-first-class task 3.1): the committed
 * file loads the four starters in order, an invalid starter is left out and
 * logged without hiding the others, and an unreadable file is a problem.
 */

describe("the committed starters file", () => {
  it("loads the four starters, in the order Build your solution shows them", () => {
    const result = readStarters(STARTERS_FILE);
    expect(result).toMatchObject({ ok: true, skipped: [] });
    if (!result.ok) return;
    expect(result.starters.map((starter) => [starter.slug, starter.title, starter.kind])).toEqual([
      ["de-web-boilerplate", "DE Web Boilerplate", "web"],
      ["salt-dashboard", "Salt Dashboard", "dashboard"],
      ["salt-starter", "Salt Starter", "web"],
      ["agent-starter", "Agent Starter", "agent"],
    ]);
    for (const starter of result.starters) {
      expect(fs.existsSync(path.join("public", starter.preview)), starter.preview).toBe(true);
      expect(starter.steps.length).toBeGreaterThan(0);
    }
  });
});

describe("readStarters", () => {
  let directory: string;
  const write = (source: string) => {
    const file = path.join(directory, "starters.yaml");
    fs.writeFileSync(file, source);
    return file;
  };
  const starter = (slug: string, extra = "") => `  - slug: ${slug}
    kind: web
    title: ${slug}
    description: A starter
    preview: /starters/${slug}.svg
    sourceUrl: https://github.com/acme/${slug}
    steps:
      - text: Copy it
        command: git clone https://github.com/acme/${slug}.git
${extra}`;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "starters-"));
  });
  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("leaves out a starter with a missing field, saying which, and keeps the others", () => {
    const file = write(`starters:\n${starter("first")}  - slug: broken\n    kind: web\n    title: Broken\n${starter("second")}`);
    const result = readStarters(file);
    expect(result.ok && result.starters.map((entry) => entry.slug)).toEqual(["first", "second"]);
    expect(result.ok && result.skipped).toEqual([expect.stringMatching(/starters\.1 \(broken\) at description: /)]);
  });

  it.each([
    ["an unknown kind", "kind: kiosk", "kind"],
    ["a source that isn't https", "sourceUrl: http://github.com/acme/x", "sourceUrl"],
    ["a preview outside public/", "preview: https://cdn.example.com/x.png", "preview"],
  ])("leaves out a starter with %s", (_case, line, field) => {
    const file = write(`starters:\n${starter("bad").replace(new RegExp(`${field}: .*`), line)}`);
    const result = readStarters(file);
    expect(result.ok && result.starters).toEqual([]);
    expect(result.ok && result.skipped[0]).toContain(`at ${field}`);
  });

  it("leaves out a second starter with the same slug", () => {
    const result = readStarters(write(`starters:\n${starter("same")}${starter("same")}`));
    expect(result.ok && result.starters).toHaveLength(1);
    expect(result.ok && result.skipped).toEqual([expect.stringContaining("another starter has the slug same")]);
  });

  it("returns a problem for a missing file, invalid YAML, and a file without a starters list", () => {
    expect(readStarters(path.join(directory, "missing.yaml"))).toMatchObject({ ok: false, problem: expect.stringContaining("can't be read") });
    expect(readStarters(write("starters: [\n"))).toMatchObject({ ok: false, problem: expect.stringContaining("isn't valid YAML") });
    expect(readStarters(write("templates: []\n"))).toMatchObject({ ok: false, problem: expect.stringContaining("needs a top-level starters list") });
  });

  it("logs each problem once, and returns null for an unusable file", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("FABRICATE_STARTERS_FILE", path.join(directory, "missing.yaml"));
    expect(starters()).toBeNull();
    expect(starters()).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toMatch(/^Starters are unavailable: /);
  });
});

describe("the documented example", () => {
  it("loads with the starters loader, as docs/applications.md says it does", () => {
    const doc = fs.readFileSync(path.join("docs", "applications.md"), "utf8");
    const example = /```yaml\n([\s\S]*?)```/.exec(doc)?.[1];
    expect(example, "docs/applications.md holds a YAML example").toBeDefined();
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "starters-doc-")), "starters.yaml");
    fs.writeFileSync(file, example!);
    const result = readStarters(file);
    expect(result).toMatchObject({ ok: true, skipped: [] });
    expect(result.ok && result.starters.map((starter) => starter.slug)).toEqual(["salt-starter"]);
  });
});
