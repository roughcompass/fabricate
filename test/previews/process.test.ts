import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CommandSpec, runCommand } from "@/lib/previews/process";

/*
 * The preview build's processes (design decision 4): each runs in a process
 * group of its own with a constructed environment, and on timeout or abort
 * the whole group is killed, including whatever the process spawned.
 */

describe("preview build processes", () => {
  let directory: string;
  let output: string;
  beforeEach(() => {
    directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preview-process-")));
    output = "";
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  const node = (script: string, overrides: Partial<CommandSpec> = {}): CommandSpec => ({
    command: process.execPath,
    args: ["-e", script],
    cwd: directory,
    env: { PATH: "/usr/bin:/bin" },
    output: (chunk) => (output += chunk.toString("utf8")),
    deadline: Date.now() + 10_000,
    ...overrides,
  });

  /** A parent that starts a sleeping grandchild, records both pids, and sleeps. */
  const family = (pids: string) =>
    node(
      `const { spawn } = require("node:child_process");
       const child = spawn("sleep", ["60"], { stdio: "ignore" });
       require("node:fs").writeFileSync(${JSON.stringify(pids)}, JSON.stringify([process.pid, child.pid]));
       console.log("started");
       setTimeout(() => {}, 60_000);`,
    );
  const started = async (pids: string): Promise<number[]> => {
    for (let waited = 0; !fs.existsSync(pids); waited += 10) {
      if (waited > 5_000) throw new Error("the process didn't start");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return JSON.parse(fs.readFileSync(pids, "utf8")) as number[];
  };
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  /** Waits for every one of +pids+ to be gone; a killed grandchild is reaped by init shortly after. */
  const gone = async (pids: number[]) => {
    for (let waited = 0; pids.some(alive); waited += 20) {
      if (waited > 5_000) return false;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return true;
  };

  it("passes its output on and reports how it exited", async () => {
    expect(await runCommand(node("console.log('out'); console.error('err'); process.exit(3)"))).toEqual({ outcome: "exited", code: 3, signal: null });
    expect(output).toContain("out");
    expect(output).toContain("err");
  });

  it("gives the process only the environment it was handed", async () => {
    process.env.FRONTEND_REGISTRY_TEST_SECRET = "frontend-registry-secret";
    process.env.GIT_ASKPASS = "/usr/local/bin/askpass";
    try {
      await runCommand(node("console.log(JSON.stringify(Object.keys(process.env)))", { env: { PATH: "/usr/bin:/bin", CI: "1" } }));
    } finally {
      delete process.env.FRONTEND_REGISTRY_TEST_SECRET;
      delete process.env.GIT_ASKPASS;
    }
    // macOS adds __CF_USER_TEXT_ENCODING to every process; nothing else comes from the parent.
    expect((JSON.parse(output) as string[]).filter((key) => key !== "__CF_USER_TEXT_ENCODING").sort()).toEqual(["CI", "PATH"]);
  });

  it("kills the whole process group, grandchildren included, at the deadline", async () => {
    const pids = path.join(directory, "pids.json");
    const result = runCommand({ ...family(pids), deadline: Date.now() + 1_500 });
    const [parent, grandchild] = await started(pids);
    expect(alive(parent!) && alive(grandchild!)).toBe(true);

    expect(await result).toEqual({ outcome: "timed_out" });
    expect(await gone([parent!, grandchild!])).toBe(true);
  });

  it("kills the whole process group when aborted, as when the job's lease is lost", async () => {
    const pids = path.join(directory, "pids.json");
    const controller = new AbortController();
    const result = runCommand({ ...family(pids), signal: controller.signal });
    const [parent, grandchild] = await started(pids);

    controller.abort(new Error("The job's lease was lost"));
    expect(await result).toEqual({ outcome: "aborted" });
    expect(await gone([parent!, grandchild!])).toBe(true);
  });

  it("kills what a finished process left running in its group", async () => {
    const pids = path.join(directory, "pids.json");
    const spec = node(
      `const { spawn } = require("node:child_process");
       const child = spawn("sleep", ["60"], { stdio: "ignore" });
       child.unref();
       require("node:fs").writeFileSync(${JSON.stringify(pids)}, JSON.stringify([process.pid, child.pid]));`,
    );
    expect(await runCommand(spec)).toEqual({ outcome: "exited", code: 0, signal: null });
    expect(await gone(await started(pids))).toBe(true);
  });
});
