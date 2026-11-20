// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { AgentChannel, type Scheduler, type WatchedFrame, runAgent, watchDocuments } from "@/components/toolbar/frame-agent";
import { INSPECTOR_MESSAGE, INSPECTOR_REGISTRY, type InspectorMessage } from "@/components/toolbar/inspector/protocol";

/*
 * Early attach (restore-toolbar-tools-and-branch-previews, design decision 6,
 * task 6.2): the toolbar finds each new document a running application's
 * frame loads as soon as it exists, runs the frame agent in its realm once,
 * and keeps the agent's messages by page, so a tool that subscribes late
 * still sees the page's earliest.
 */

/** A window of one page in the frame: its address, its listeners, and its realm's Function, which records what it runs. */
class FakeWindow extends EventTarget {
  readonly ran: string[] = [];
  readonly location: { href: string };
  [INSPECTOR_REGISTRY]?: { page: string; elements: Map<number, WeakRef<Element>> };

  readonly Function: FunctionConstructor;

  constructor(href: string) {
    super();
    this.location = { href };
    this.Function = realmFunction(this);
  }
}

/** A realm's Function constructor for +view+: the agent's text installs its registry, as the real agent does. */
function realmFunction(view: FakeWindow): FunctionConstructor {
  return function RealmFunction(text: string) {
    return () => {
      view.ran.push(text);
      view[INSPECTOR_REGISTRY] ??= { page: `page-${view.ran.length}`, elements: new Map() };
    };
  } as unknown as FunctionConstructor;
}

/** A frame whose page the test replaces, as a navigation does. */
class FakeFrame implements WatchedFrame {
  view = new FakeWindow("about:blank");
  doc = {} as Document;

  get contentWindow() {
    return this.view as unknown as Window;
  }

  get contentDocument() {
    return this.doc;
  }

  navigate(href: string) {
    this.view = new FakeWindow(href);
    this.doc = {} as Document;
  }
}

/** A scheduler the test drives: each turn runs every frame and task callback waiting. */
function manualScheduler() {
  let queue: (() => void)[] = [];
  let clock = 0;
  const scheduler: Scheduler = {
    frame(callback) {
      queue.push(callback);
      return () => (queue = queue.filter((each) => each !== callback));
    },
    task(callback) {
      queue.push(callback);
      return () => (queue = queue.filter((each) => each !== callback));
    },
    now: () => clock,
  };
  return {
    scheduler,
    turn(ms = 16) {
      clock += ms;
      const due = queue;
      queue = [];
      for (const callback of due) callback();
    },
    get waiting() {
      return queue.length;
    },
  };
}

function watch(frame: FakeFrame) {
  const clock = manualScheduler();
  const found: FakeWindow[] = [];
  const watcher = watchDocuments(frame, (view) => {
    runAgent(view, "agent");
    found.push(view as unknown as FakeWindow);
  }, clock.scheduler);
  return { clock, found, watcher };
}

describe("early attach", () => {
  it("waits out the initial blank page, then attaches to the first document as soon as it exists", () => {
    const frame = new FakeFrame();
    const { clock, found, watcher } = watch(frame);
    watcher.arm();
    clock.turn();
    clock.turn();
    expect(found).toEqual([]);
    frame.navigate("http://127.0.0.1/previews/pvw_desk/");
    clock.turn();
    expect(found).toEqual([frame.view]);
    expect(frame.view.ran).toEqual(["agent"]);
    // Once found, it stops looking.
    expect(clock.waiting).toBe(0);
  });

  it("attaches once per document, however often it's checked", () => {
    const frame = new FakeFrame();
    frame.navigate("http://127.0.0.1/previews/pvw_desk/");
    const { clock, found, watcher } = watch(frame);
    watcher.arm();
    watcher.check();
    clock.turn();
    watcher.check();
    expect(found).toHaveLength(1);
    expect(frame.view.ran).toEqual(["agent"]);
  });

  it("starts looking again when the page leaves, and attaches to the next document", () => {
    const frame = new FakeFrame();
    frame.navigate("http://127.0.0.1/previews/pvw_desk/");
    const { clock, found, watcher } = watch(frame);
    watcher.arm();
    const first = frame.view;
    first.dispatchEvent(new Event("pagehide"));
    clock.turn();
    expect(found).toEqual([first]);
    frame.navigate("http://127.0.0.1/previews/pvw_desk/blotter");
    clock.turn();
    expect(found).toEqual([first, frame.view]);
    expect(frame.view.ran).toEqual(["agent"]);
  });

  it("gives up after a while, leaving load's fallback to attach", () => {
    const frame = new FakeFrame();
    const { clock, watcher } = watch(frame);
    watcher.arm();
    clock.turn(16_000);
    expect(clock.waiting).toBe(0);
  });

  it("never runs the agent twice in a page where it already runs", () => {
    const view = new FakeWindow("http://127.0.0.1/previews/pvw_desk/");
    expect(runAgent(view as unknown as Window, "agent")).toBe(true);
    expect(runAgent(view as unknown as Window, "agent")).toBe(false);
    expect(view.ran).toEqual(["agent"]);
  });
});

describe("the agent's channel", () => {
  const message = (page: string, eventTiming: boolean): InspectorMessage => ({ type: INSPECTOR_MESSAGE, page, kind: "ready", eventTiming });

  it("replays a page's earlier messages to a late subscriber, then streams new ones, and keeps pages apart", () => {
    const channel = new AgentChannel();
    channel.push(message("one", true));
    channel.push(message("two", false));
    const seen: InspectorMessage[] = [];
    const stop = channel.subscribe("one", (each) => seen.push(each));
    channel.push(message("one", false));
    channel.push(message("two", true));
    expect(seen.map((each) => [each.page, each.kind === "ready" && each.eventTiming])).toEqual([
      ["one", true],
      ["one", false],
    ]);
    stop();
    channel.push(message("one", true));
    expect(seen).toHaveLength(2);
  });
});
