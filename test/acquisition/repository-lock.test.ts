import { describe, expect, it } from "vitest";
import { withRepositoryLock } from "@/lib/acquisition/repository-lease";

/** A unit of work that records when it starts and ends, and finishes when told to. */
function step(log: string[], name: string) {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  return {
    finish,
    work: async () => {
      log.push(`${name} start`);
      await finished;
      log.push(`${name} end`);
      return name;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("source lock", () => {
  it("runs two acquisitions of one repository one after the other", async () => {
    const log: string[] = [];
    const [first, second] = [step(log, "first"), step(log, "second")];
    const running = [withRepositoryLock(1, { waitMs: 5_000 }, first.work), withRepositoryLock(1, { waitMs: 5_000 }, second.work)];

    await tick();
    expect(log).toEqual(["first start"]);
    first.finish();
    await tick();
    second.finish();

    expect(await Promise.all(running)).toEqual(["first", "second"]);
    expect(log).toEqual(["first start", "first end", "second start", "second end"]);
  });

  it("runs acquisitions of two repositories in parallel", async () => {
    const log: string[] = [];
    const [orders, billing] = [step(log, "orders"), step(log, "billing")];
    const running = [withRepositoryLock(1, { waitMs: 5_000 }, orders.work), withRepositoryLock(2, { waitMs: 5_000 }, billing.work)];

    await tick();
    expect(log).toEqual(["orders start", "billing start"]);
    orders.finish();
    billing.finish();
    await Promise.all(running);
  });

  it("gives up after waiting, or when canceled, and keeps the queue in order behind the work still running", async () => {
    const log: string[] = [];
    const [held, last] = [step(log, "held"), step(log, "last")];
    const running = withRepositoryLock(3, { waitMs: 5_000 }, held.work);
    await tick();

    await expect(withRepositoryLock(3, { waitMs: 20 }, async () => "never")).rejects.toMatchObject({ code: "lock_timeout" });
    const controller = new AbortController();
    const canceled = withRepositoryLock(3, { waitMs: 5_000, signal: controller.signal }, async () => "never");
    controller.abort();
    await expect(canceled).rejects.toMatchObject({ code: "canceled" });

    const queued = withRepositoryLock(3, { waitMs: 5_000 }, last.work);
    await tick();
    expect(log).toEqual(["held start"]);
    held.finish();
    await running;
    await tick();
    last.finish();
    expect(await queued).toBe("last");
    expect(log).toEqual(["held start", "held end", "last start", "last end"]);
  });
});
