import { afterEach, describe, expect, it } from "vitest";
import { MINIMUM_GIT_VERSION, describeCapability, gitCapability, verifyGit } from "@/lib/git/capability";
import { GitRunner } from "@/lib/git/runner";
import { fakeExecutable } from "../support/fake-git";

describe("Git capability", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  const runnerFor = (body: string) => {
    const fake = fakeExecutable(body);
    cleanups.push(fake.cleanup);
    return new GitRunner({ executable: fake.executable });
  };

  it("reports the installed Git as supported", async () => {
    const capability = await verifyGit(new GitRunner());

    expect(capability.supported).toBe(true);
    expect(describeCapability(capability)).toMatch(/^Git \d+\.\d+(\.\d+)? at git \(supported\)$/);
  });

  it("accepts the minimum version and platform suffixes", async () => {
    const capability = await verifyGit(runnerFor(`echo "git version ${MINIMUM_GIT_VERSION} (Apple Git-155)"`));
    expect(capability.version).toBe(MINIMUM_GIT_VERSION);
  });

  it("rejects a Git older than the minimum", async () => {
    const runner = runnerFor('echo "git version 2.31.9"');

    expect((await gitCapability(runner)).supported).toBe(false);
    await expect(verifyGit(runner)).rejects.toMatchObject({ code: "git_unsupported", message: expect.stringContaining("2.31.9") });
  });

  it("rejects output that is not a Git version", async () => {
    await expect(verifyGit(runnerFor('echo "definitely not git"'))).rejects.toMatchObject({ code: "git_unsupported" });
  });

  it("reports a missing executable as unavailable", async () => {
    const runner = new GitRunner({ executable: "/nonexistent/fabricate-git" });
    await expect(verifyGit(runner)).rejects.toMatchObject({ code: "git_unavailable", message: expect.stringContaining("ENOENT") });
  });

  it("reports a failing executable without leaking credentials", async () => {
    const runner = runnerFor('echo "fatal: https://user:hunter2@example.com/repo" >&2; exit 3');

    const error = await verifyGit(runner).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "command_failed" });
    expect(String((error as Error).message)).not.toContain("hunter2");
  });
});
