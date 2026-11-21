import { describe, expect, it, vi } from "vitest";
import { ROUTING_MESSAGE, type ArmedMocks, type RoutedEntry, type RoutingCommand } from "@/components/toolbar/routing/table";
import { ViewWorker, type WorkerEnvironment, mocksKey, routingKey, usedElsewhere, workerRefusal } from "@/components/toolbar/routing/view-worker";

/*
 * The view worker's coordinator (add-mock-sets, design decision 2, task
 * 8.1): one table per view, composed from Microfrontends' routing and Data's
 * mock set and sent in one arm per load, and a worker unregistered only once
 * neither applies to any view of its build in this browser.
 */

const ORIGIN = "http://127.0.0.1:3100";
const SCOPE = "/previews/pvw_desk/";
const SCRIPT = `${ORIGIN}/toolbar/routing-worker.js`;
const ROUTE: RoutedEntry = { name: "quotesPanel", mechanism: "module-federation", from: "http://127.0.0.1:9311/remoteEntry.js", to: `${ORIGIN}/previews/pvw_panel/remoteEntry.js` };
const MOCKS: ArmedMocks = { application: "quotes-desk", set: "mks_happy", revision: 3, latency: "off" };

/** Local storage, as the browser keeps it. */
class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
}

/** A browser whose service worker container registers the view's worker, which answers each command as +answer+ says. */
function browser(options: { foreign?: boolean; answer?: (command: RoutingCommand) => unknown } = {}) {
  const commands: RoutingCommand[] = [];
  const unregister = vi.fn(async () => true);
  let registered = false;
  const worker = {
    state: "activated",
    scriptURL: options.foreign ? `${ORIGIN}${SCOPE}sw.js` : SCRIPT,
    postMessage(command: RoutingCommand, [port]: MessagePort[]) {
      commands.push(command);
      const answer = options.answer ? options.answer(command) : { type: ROUTING_MESSAGE, ok: true, ...(command.command === "arm" && command.table.mocks ? { mocks: { ok: true, revision: command.table.mocks.revision } } : {}) };
      if (answer) port!.postMessage(answer);
    },
  };
  const registration = { active: worker, installing: null, waiting: null, unregister, update: vi.fn(async () => {}) };
  const container = {
    register: vi.fn(async () => {
      registered = true;
      return registration;
    }),
    getRegistration: vi.fn(async () => (registered || options.foreign ? registration : undefined)),
  };
  const storage = new MemoryStorage();
  const environment: WorkerEnvironment = { origin: ORIGIN, secure: true, container: container as unknown as ServiceWorkerContainer, storage, answerMs: () => 200 };
  return { environment, storage, commands, container, unregister, register: () => (registered = true) };
}

const own = (environment: WorkerEnvironment, view = "quotes-desk") => new ViewWorker({ view: `/run/${view}` }, SCOPE, { routing: routingKey(view), mocks: mocksKey(view) }, environment);

describe("the view's table", () => {
  it("holds Microfrontends' routing and Data's mock set together, so one arm carries both", async () => {
    const world = browser();
    const worker = own(world.environment);
    worker.setRouting({ routes: [ROUTE], kept: [] });
    worker.setMocks(MOCKS);
    const status = await worker.prepare(null);
    expect(status).toEqual({ routed: true, mocks: MOCKS, refusal: null, readiness: { ok: true, revision: 3 } });
    expect(world.commands).toEqual([{ type: ROUTING_MESSAGE, command: "arm", frame: null, table: { view: "/run/quotes-desk", share: null, scope: SCOPE, routes: [ROUTE], kept: [], mocks: MOCKS } }]);
    expect(world.container.register).toHaveBeenCalledWith("/toolbar/routing-worker.js", { scope: SCOPE, updateViaCache: "none" });
    // The view records the build it applies a set to.
    expect(JSON.parse(world.storage.getItem(mocksKey("quotes-desk"))!)).toEqual({ scope: SCOPE, set: "mks_happy" });
  });

  it("names a share link's view by its token, and keeps nothing for it in the browser", async () => {
    const world = browser();
    const worker = new ViewWorker({ view: "/run/quotes-desk", share: "tok" }, SCOPE, null, world.environment);
    worker.setMocks(MOCKS);
    await worker.prepare(null);
    expect((world.commands[0] as Extract<RoutingCommand, { command: "arm" }>).table).toMatchObject({ view: "/run/quotes-desk", share: "tok" });
    expect(world.storage.length).toBe(0);
  });

  it("arms routing alone as before, without a mock set", async () => {
    const world = browser();
    const worker = own(world.environment);
    worker.setRouting({ routes: [ROUTE], kept: ["http://127.0.0.1:9312/ticker.js"] });
    expect(await worker.prepare("http://x/frame")).toEqual({ routed: true, mocks: null, refusal: null, readiness: null });
    expect(world.commands).toEqual([{ type: ROUTING_MESSAGE, command: "arm", frame: "http://x/frame", table: { view: "/run/quotes-desk", share: null, scope: SCOPE, routes: [ROUTE], kept: ["http://127.0.0.1:9312/ticker.js"], mocks: null } }]);
  });

  it("reports a set the worker couldn't make ready, and a worker that never answered about it", async () => {
    const failing = browser({ answer: () => ({ type: ROUTING_MESSAGE, ok: true, mocks: { ok: false, reason: "The mock set couldn't be fetched (status 500)." } }) });
    const worker = own(failing.environment);
    worker.setMocks(MOCKS);
    expect((await worker.prepare(null)).readiness).toEqual({ ok: false, reason: "The mock set couldn't be fetched (status 500)." });

    const silent = browser({ answer: () => null });
    const other = own(silent.environment);
    other.setMocks(MOCKS);
    expect((await other.prepare(null)).readiness).toMatchObject({ ok: false });
  });

  it("updates a worker from before mock sets, which answers without them, and arms the new one", async () => {
    let updated = false;
    const world = browser({ answer: (command) => ({ type: ROUTING_MESSAGE, ok: true, ...(updated && command.command === "arm" ? { mocks: { ok: true, revision: 3 } } : {}) }) });
    const registration = await world.environment.container!.register("x");
    (registration.update as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      updated = true;
    });
    const worker = own(world.environment);
    worker.setMocks(MOCKS);
    expect((await worker.prepare(null)).readiness).toEqual({ ok: true, revision: 3 });
    expect(world.commands.filter((command) => command.command === "arm")).toHaveLength(2);
  });
});

describe("refusals", () => {
  it("refuses beside the application's own worker, outside a secure context, and without service workers, before registering anything", async () => {
    const foreign = browser({ foreign: true });
    expect(await workerRefusal(SCOPE, foreign.environment)).toBe("foreign");
    const worker = own(foreign.environment);
    worker.setMocks(MOCKS);
    expect(await worker.prepare(null)).toMatchObject({ refusal: "foreign", readiness: null });
    expect(foreign.container.register).not.toHaveBeenCalled();
    expect(await workerRefusal(SCOPE, { ...foreign.environment, secure: false })).toBe("insecure");
    expect(await workerRefusal(SCOPE, { ...foreign.environment, container: null })).toBe("unsupported");
  });
});

describe("releasing the worker", () => {
  it("disarms a view that applies nothing, and unregisters the worker when no other view of the build uses it", async () => {
    const world = browser();
    world.register();
    const worker = own(world.environment);
    expect(await worker.prepare(null)).toEqual({ routed: false, mocks: null, refusal: null, readiness: null });
    expect(world.commands).toEqual([{ type: ROUTING_MESSAGE, command: "disarm", view: "/run/quotes-desk", share: null }]);
    expect(world.unregister).toHaveBeenCalledOnce();
  });

  it("keeps the worker while another view of the build routes it or applies a set to it", async () => {
    const world = browser();
    world.register();
    // A saved preview's view of the same build routes it.
    world.storage.setItem(routingKey("quotes-desk@feature-blue"), JSON.stringify({ scope: SCOPE, routes: [ROUTE] }));
    await own(world.environment).prepare(null);
    expect(world.unregister).not.toHaveBeenCalled();

    world.storage.clear();
    world.storage.setItem(mocksKey("quotes-desk@feature-blue"), JSON.stringify({ scope: SCOPE, set: "mks_errors" }));
    await own(world.environment).prepare(null);
    expect(world.unregister).not.toHaveBeenCalled();

    // A view that applied a set to another build, or only keeps a latency, doesn't count.
    world.storage.clear();
    world.storage.setItem(mocksKey("quotes-desk@feature-blue"), JSON.stringify({ scope: "/previews/pvw_old/", set: "mks_errors" }));
    world.storage.setItem(mocksKey("orders-portal"), JSON.stringify({ latency: "slow" }));
    await own(world.environment).prepare(null);
    expect(world.unregister).toHaveBeenCalledOnce();
  });

  it("forgets the build a view applied a set to once it applies none, and keeps its latency", async () => {
    const world = browser();
    world.storage.setItem(mocksKey("quotes-desk"), JSON.stringify({ latency: "slow" }));
    const worker = own(world.environment);
    worker.setMocks({ ...MOCKS, latency: "slow" });
    await worker.prepare(null);
    expect(usedElsewhere(world.storage, SCOPE, [])).toBe(true);
    worker.setMocks(null);
    await worker.prepare(null);
    expect(usedElsewhere(world.storage, SCOPE, [])).toBe(false);
    expect(JSON.parse(world.storage.getItem(mocksKey("quotes-desk"))!)).toEqual({ latency: "slow" });
    expect(world.unregister).toHaveBeenCalledOnce();
  });

  it("never touches a registration that isn't the view's worker", async () => {
    const world = browser({ foreign: true });
    await own(world.environment).prepare(null);
    expect(world.commands).toEqual([]);
    expect(world.unregister).not.toHaveBeenCalled();
  });
});

describe("arming again", () => {
  it("arms the worker already registered with the table of the last load, and never registers it", async () => {
    const world = browser();
    const worker = own(world.environment);
    await worker.rearm(null);
    expect(world.commands).toEqual([]);
    worker.setMocks(MOCKS);
    await worker.prepare(null);
    // A choice made since applies at the next load, not before.
    worker.setMocks(null);
    await worker.rearm("http://x/frame");
    expect(world.commands.at(-1)).toMatchObject({ command: "arm", frame: "http://x/frame", table: { mocks: MOCKS } });
    expect(world.container.register).toHaveBeenCalledOnce();
  });
});
