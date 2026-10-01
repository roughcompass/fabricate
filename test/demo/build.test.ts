import { describe, expect, it } from "vitest";
import { buildProgress } from "@/lib/demo/build";
import { stagesFor, totalDuration } from "@/lib/demo/catalog";

const CREATED = Date.UTC(2026, 8, 30, 12, 0, 0);
const sandbox = stagesFor("sandbox", { templateSlug: "market-watch", templateVersion: "4.0.2", url: "https://market-watch-abcd.sandbox.deweb.example" });
const dev = stagesFor("dev", {
  templateSlug: "market-watch",
  templateVersion: "4.0.2",
  url: "https://payee-portal-abcd.dev.deweb.example",
  project: "PAY",
  repository: "payee-portal",
  repositoryUrl: "https://bitbucket.deweb.example/projects/PAY/repos/payee-portal",
});

const states = (progress: ReturnType<typeof buildProgress>) => progress.stages.map((stage) => stage.state);

describe("simulated build progress", () => {
  it("starts in the first stage, showing only its first log line", () => {
    const progress = buildProgress(sandbox, CREATED, CREATED);
    expect(progress.status).toBe("building");
    expect(progress.current).toBe(0);
    expect(states(progress)).toEqual(["active", "pending", "pending", "pending", "pending", "pending"]);
    expect(progress.stages[0]!.lines).toEqual(["Build queued on a sandbox runner"]);
    expect(progress.stages[1]!.lines).toEqual([]);
  });

  it("advances through every sandbox stage boundary and is ready after about 10 seconds", () => {
    let offset = 0;
    sandbox.forEach((stage, index) => {
      expect(buildProgress(sandbox, CREATED, CREATED + offset).current, `start of ${stage.name}`).toBe(index);
      expect(buildProgress(sandbox, CREATED, CREATED + offset + stage.durationMs - 1).current, `end of ${stage.name}`).toBe(index);
      offset += stage.durationMs;
    });
    const done = buildProgress(sandbox, CREATED, CREATED + offset);
    expect(done.status).toBe("ready");
    expect(done.current).toBe(sandbox.length);
    expect(states(done).every((state) => state === "done")).toBe(true);
    expect(done.stages.at(-1)!.lines).toEqual(["Assigned https://market-watch-abcd.sandbox.deweb.example"]);
    expect(done.readyAt - CREATED).toBe(totalDuration(sandbox));
    expect(totalDuration(sandbox)).toBeGreaterThanOrEqual(9000);
    expect(totalDuration(sandbox)).toBeLessThanOrEqual(11000);
  });

  it("shows the same progress whenever it is asked, as after a reload", () => {
    const now = CREATED + 5000;
    expect(buildProgress(sandbox, CREATED, now)).toEqual(buildProgress(sandbox, CREATED, now));
    expect(buildProgress(sandbox, CREATED, now).stages[buildProgress(sandbox, CREATED, now).current]!.name).toBe("Building");
  });

  it("names the project and repository in a dev build that is ready after about 15 seconds", () => {
    const progress = buildProgress(dev, CREATED, CREATED + 1000);
    expect(progress.stages[progress.current]!.name).toBe("Creating BitBucket repository PAY/payee-portal");
    expect(progress.stages.map((stage) => stage.name)).toContain("Running pipeline #1");
    expect(buildProgress(dev, CREATED, CREATED + totalDuration(dev) - 1).status).toBe("building");
    expect(buildProgress(dev, CREATED, CREATED + totalDuration(dev)).status).toBe("ready");
    expect(totalDuration(dev)).toBeGreaterThanOrEqual(14000);
    expect(totalDuration(dev)).toBeLessThanOrEqual(16000);
  });

  it("completes every remaining stage at once when skipped", () => {
    const skippedAt = CREATED + 3000;
    const progress = buildProgress(sandbox, CREATED, skippedAt, skippedAt);
    expect(progress.status).toBe("ready");
    expect(progress.skipped).toBe(true);
    expect(progress.readyAt).toBe(skippedAt);
    expect(states(progress).every((state) => state === "done")).toBe(true);
    expect(progress.elapsedMs).toBe(progress.totalMs);
  });

  it("ignores a skip that came after the build had already finished", () => {
    const late = buildProgress(sandbox, CREATED, CREATED + 60_000, CREATED + 30_000);
    expect(late.skipped).toBe(false);
    expect(late.readyAt).toBe(CREATED + totalDuration(sandbox));
  });

  it("treats a clock behind the creation time as the start of the build", () => {
    expect(buildProgress(sandbox, CREATED, CREATED - 5000).current).toBe(0);
  });
});
