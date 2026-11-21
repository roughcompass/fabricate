import { type ArmAnswer, type ArmedMocks, type MockLatency, type MocksReadiness, type RoutedEntry, type RoutingCommand, type ViewIdentity, type ViewTable, ROUTING_MESSAGE, ROUTING_WORKER_SCRIPT, foreignWorker } from "./table";

/*
 * The view worker's coordinator (add-mock-sets, design decision 2). One
 * service worker per build serves a view's version routing and its mock
 * set, so one table per view holds both: Microfrontends contributes the
 * routing and Data the mock set, and before each load of the frame the
 * coordinator composes them and sends one arm. Arming each on its own would
 * let one overwrite the other's table.
 *
 * The worker is disarmed for a view when neither applies to it, and
 * unregistered only once neither applies to any view of that build in this
 * browser: views keep their routing under `frontend-registry:routing:<view>`
 * and record the build they apply a set to under
 * `frontend-registry:mocks:<view>`, which also keeps Data's latency.
 */

const ROUTING_PREFIX = "frontend-registry:routing:";
const MOCKS_PREFIX = "frontend-registry:mocks:";

/** Where a view keeps its routing in this browser. */
export const routingKey = (view: string) => `${ROUTING_PREFIX}${view}`;
/** Where a view records the build it applies a mock set to, and keeps its latency. */
export const mocksKey = (view: string) => `${MOCKS_PREFIX}${view}`;

/** What a view keeps under its mocks key. */
interface MocksRecord {
  /** The build the view applies a set to, while it applies one. */
  readonly scope?: string;
  readonly set?: string;
  readonly latency?: MockLatency;
}

/** Why the view's worker can't run for a build: no secure context, no service workers, or the application's own worker for the build's path. */
export type WorkerRefusal = "insecure" | "unsupported" | "foreign";

/** The browser the coordinator works in; the toolbar's is the page's own (browserWorkerEnvironment). */
export interface WorkerEnvironment {
  readonly origin: string;
  readonly secure: boolean;
  readonly container: ServiceWorkerContainer | null;
  readonly storage: Storage | null;
  /** How long to wait for the worker's answer, in milliseconds, before loading the frame anyway. */
  readonly answerMs?: (mocks: boolean) => number;
}

export function browserWorkerEnvironment(): WorkerEnvironment {
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    // Without storage, nothing is recorded, and nothing is unregistered for another view's sake.
  }
  return { origin: window.location.origin, secure: window.isSecureContext, container: "serviceWorker" in navigator ? navigator.serviceWorker : null, storage };
}

function readRecord(storage: Storage | null, key: string): MocksRecord {
  try {
    const stored = JSON.parse(storage?.getItem(key) ?? "null") as MocksRecord | null;
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

function writeRecord(storage: Storage | null, key: string, record: MocksRecord): void {
  try {
    if (record.scope || (record.latency && record.latency !== "off")) storage?.setItem(key, JSON.stringify(record));
    else storage?.removeItem(key);
  } catch {
    // Without storage, the record lasts until the page is left.
  }
}

/** Whether a view other than those keeping +own+ keys routes the build at +scope+, or applies a set to it. */
export function usedElsewhere(storage: Storage | null, scope: string, own: readonly string[]): boolean {
  if (!storage) return false;
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key || own.includes(key)) continue;
      if (key.startsWith(ROUTING_PREFIX)) {
        const stored = JSON.parse(storage.getItem(key) ?? "null") as { scope?: unknown; routes?: unknown[] } | null;
        if (stored?.scope === scope && Array.isArray(stored.routes) && stored.routes.length) return true;
      } else if (key.startsWith(MOCKS_PREFIX)) {
        const stored = readRecord(storage, key);
        if (stored.scope === scope && stored.set) return true;
      }
    }
  } catch {
    // Storage that can't be read keeps nothing in use.
  }
  return false;
}

/** The worker's address, absolute, as a registration names its script. */
const workerUrl = (origin: string) => new URL(ROUTING_WORKER_SCRIPT, origin).href;

/** Why the view's worker can't run for the build at +scope+, or null when it can. */
export async function workerRefusal(scope: string, environment: WorkerEnvironment): Promise<WorkerRefusal | null> {
  if (!environment.secure) return "insecure";
  const container = environment.container;
  if (!container) return "unsupported";
  try {
    const registration = await container.getRegistration(scope);
    if (registration && foreignWorker([registration.active?.scriptURL, registration.waiting?.scriptURL, registration.installing?.scriptURL], workerUrl(environment.origin))) return "foreign";
  } catch {
    return "unsupported";
  }
  return null;
}

/**
 * The registration's newest worker once it's active: one installing or
 * waiting replaces the active one at once, so it's the one to arm. When it
 * fails to install, the active one stays.
 */
function activated(registration: ServiceWorkerRegistration): Promise<ServiceWorker> {
  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) return Promise.reject(new Error("The view's worker didn't install"));
  if (worker.state === "activated") return Promise.resolve(worker);
  return new Promise((resolve, reject) => {
    const changed = () => {
      if (worker.state === "activated") resolve(worker);
      else if (worker.state !== "redundant") return;
      else if (registration.active?.state === "activated") resolve(registration.active);
      else reject(new Error("The view's worker didn't install"));
      worker.removeEventListener("statechange", changed);
    };
    worker.addEventListener("statechange", changed);
  });
}

/** Sends +command+ to +worker+ and waits until it's been applied, or +waitMs+ passed; returns the worker's answer, or null. */
function send(worker: ServiceWorker, command: RoutingCommand, waitMs: number): Promise<ArmAnswer | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), waitMs);
    channel.port1.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      channel.port1.close();
      const answer = event.data as ArmAnswer | null;
      resolve(answer && answer.type === ROUTING_MESSAGE ? answer : null);
    };
    worker.postMessage(command, [channel.port2]);
  });
}

/** A view's routing, as Microfrontends contributes it. */
export interface RoutingPart {
  readonly routes: readonly RoutedEntry[];
  readonly kept: readonly string[];
}

/** What the last load applied, and what the worker answered. */
export interface ViewWorkerStatus {
  /** Whether the load applied routing. */
  readonly routed: boolean;
  /** The set the load applied, if any. */
  readonly mocks: ArmedMocks | null;
  /** Why the worker didn't run, when something applied: one of the refusals, or `failed` when it couldn't start. */
  readonly refusal: WorkerRefusal | "failed" | null;
  /** The worker's answer about the set, when one applied and the worker ran. */
  readonly readiness: MocksReadiness | null;
}

/** The reason given when the worker armed but never said the set was ready. */
const NO_ANSWER = "The Frontend Registry's service worker didn't say the mock set was ready.";

/**
 * One view's worker: the parts Microfrontends and Data contribute, the
 * table they make, and arming, rearming, and releasing the worker for the
 * view's build. +keys+ names where the view keeps its routing and mocks in
 * this browser; a share link's view keeps nothing there, so it passes null.
 */
export class ViewWorker {
  private routing: RoutingPart = { routes: [], kept: [] };
  private mocks: ArmedMocks | null = null;
  private armedTable: ViewTable | null = null;

  constructor(
    private readonly identity: ViewIdentity,
    private readonly scope: string,
    private readonly keys: { readonly routing: string; readonly mocks: string } | null,
    private readonly environment: WorkerEnvironment,
  ) {}

  setRouting(routing: RoutingPart): void {
    this.routing = routing;
  }

  setMocks(mocks: ArmedMocks | null): void {
    this.mocks = mocks;
  }

  /** The table the parts make now. */
  table(): ViewTable {
    return { view: this.identity.view, share: this.identity.share ?? null, ...(this.identity.preview === undefined ? {} : { preview: this.identity.preview }), scope: this.scope, routes: this.routing.routes, kept: this.routing.kept, mocks: this.mocks };
  }

  /** Whether the table armed at the last load applies anything, so it's armed again every few seconds. */
  get armed(): boolean {
    return this.armedTable !== null;
  }

  /**
   * Before each load of the frame: arms the worker with the view's table,
   * registering it, and waits until its set is ready; or, when nothing
   * applies, disarms the view, unregistering the worker once no view of the
   * build uses it. +frame+ is the frame's address now, if it shows a page,
   * and +page+ the frame agent's id for that page.
   */
  async prepare(frame: string | null, page: string | null = null): Promise<ViewWorkerStatus> {
    const table = this.table();
    const mocks = table.mocks ?? null;
    const routed = table.routes.length > 0;
    this.record(mocks);
    this.armedTable = null;
    if (!routed && !mocks) {
      await this.release().catch(() => {});
      return { routed, mocks, refusal: null, readiness: null };
    }
    const refusal = await workerRefusal(this.scope, this.environment);
    if (refusal) return { routed, mocks, refusal, readiness: null };
    const container = this.environment.container!;
    try {
      const registration = await container.register(ROUTING_WORKER_SCRIPT, { scope: this.scope, updateViaCache: "none" });
      const command: RoutingCommand = { type: ROUTING_MESSAGE, command: "arm", table, frame, ...(page ? { page } : {}) };
      let answer = await send(await activated(registration), command, this.waitMs(mocks));
      // A worker from before mock sets answers without them; the browser fetches the current script, which does.
      if (mocks && answer && !answer.mocks) {
        await registration.update();
        answer = await send(await activated(registration), command, this.waitMs(mocks));
      }
      this.armedTable = table;
      return { routed, mocks, refusal: null, readiness: mocks ? (answer?.mocks ?? { ok: false, reason: NO_ANSWER }) : null };
    } catch {
      return { routed, mocks, refusal: "failed", readiness: null };
    }
  }

  /** Arms the worker already registered for the build again with the table of the last load, if there is one; never registers it. */
  async rearm(frame: string | null, page: string | null = null): Promise<void> {
    const table = this.armedTable;
    const container = this.environment.container;
    if (!table || !container) return;
    const registration = await container.getRegistration(this.scope);
    if (registration?.active && registration.active.scriptURL === workerUrl(this.environment.origin)) await send(registration.active, { type: ROUTING_MESSAGE, command: "arm", table, frame, ...(page ? { page } : {}) }, this.waitMs(table.mocks ?? null));
  }

  private waitMs(mocks: ArmedMocks | null): number {
    return this.environment.answerMs?.(mocks !== null) ?? (mocks ? 15_000 : 2000);
  }

  /** Records the build the view applies a set to, or that it applies none, keeping its latency. */
  private record(mocks: ArmedMocks | null): void {
    if (!this.keys) return;
    const { latency } = readRecord(this.environment.storage, this.keys.mocks);
    writeRecord(this.environment.storage, this.keys.mocks, mocks ? { scope: this.scope, set: mocks.set, ...(latency ? { latency } : {}) } : latency ? { latency } : {});
  }

  /** Disarms the view, and unregisters the worker for the build when no other view uses it. */
  private async release(): Promise<void> {
    const { secure, container, storage, origin } = this.environment;
    if (!secure || !container) return;
    const registration = await container.getRegistration(this.scope).catch(() => undefined);
    if (!registration?.active || registration.active.scriptURL !== workerUrl(origin)) return;
    await send(registration.active, { type: ROUTING_MESSAGE, command: "disarm", view: this.identity.view, share: this.identity.share ?? null, ...(this.identity.preview === undefined ? {} : { preview: this.identity.preview }) }, 2000);
    if (!usedElsewhere(storage, this.scope, this.keys ? [this.keys.routing, this.keys.mocks] : [])) await registration.unregister();
  }
}
