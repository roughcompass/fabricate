import { describe, expect, it } from "vitest";
import { MESSAGE_LIMIT, createBus } from "@/demo/runtime/bus";

describe("runtime event bus", () => {
  it("delivers a message to every subscriber of its topic except the publisher, and records it", () => {
    let time = 1000;
    const bus = createBus(() => time);
    const received: [string, unknown][] = [];
    bus.subscribe("instrument:selected", "price-chart", (payload) => received.push(["price-chart", payload]));
    bus.subscribe("instrument:selected", "order-ticket", (payload) => received.push(["order-ticket", payload]));
    bus.subscribe("instrument:selected", "watchlist", (payload) => received.push(["watchlist", payload]));
    bus.subscribe("other", "price-chart", () => received.push(["wrong", null]));

    time = 1250;
    const message = bus.publish("instrument:selected", { symbol: "ACME" }, "watchlist");

    expect(received).toEqual([
      ["price-chart", { symbol: "ACME" }],
      ["order-ticket", { symbol: "ACME" }],
    ]);
    expect(message).toEqual({ id: 1, topic: "instrument:selected", payload: { symbol: "ACME" }, publisher: "watchlist", receivers: ["price-chart", "order-ticket"], time: 250 });
    expect(bus.messages()).toEqual([message]);
  });

  it("records messages nobody receives and messages from the toolbar", () => {
    const bus = createBus();
    bus.subscribe("payee:selected", "transfer-form", () => {});
    expect(bus.publish("unheard", 1, "toolbar").receivers).toEqual([]);
    expect(bus.publish("payee:selected", { id: "p1" }, "toolbar").receivers).toEqual(["transfer-form"]);
    expect(bus.messages().map((message) => message.publisher)).toEqual(["toolbar", "toolbar"]);
  });

  it("stops delivering after unsubscribing, and replaces a subscriber's earlier handler", () => {
    const bus = createBus();
    const calls: string[] = [];
    const unsubscribe = bus.subscribe("topic", "a", () => calls.push("first"));
    bus.subscribe("topic", "a", () => calls.push("second"));
    unsubscribe(); // removes nothing: the handler was replaced
    bus.publish("topic", null, "x");
    const off = bus.subscribe("topic", "b", () => calls.push("b"));
    off();
    bus.publish("topic", null, "x");
    expect(calls).toEqual(["second", "second"]);
  });

  it("notifies listeners and lists subscribed topics", () => {
    const bus = createBus();
    const seen: number[] = [];
    const off = bus.onMessage((message) => seen.push(message.id));
    bus.subscribe("b", "x", () => {});
    bus.subscribe("a", "y", () => {});
    bus.publish("a", 1, "z");
    off();
    bus.publish("a", 2, "z");
    expect(seen).toEqual([1]);
    expect(bus.topics()).toEqual(["a", "b"]);
  });

  it(`keeps the most recent ${MESSAGE_LIMIT} messages`, () => {
    const bus = createBus();
    for (let index = 0; index < MESSAGE_LIMIT + 5; index++) bus.publish("t", index, "x");
    expect(bus.messages()).toHaveLength(MESSAGE_LIMIT);
    expect(bus.messages()[0]!.payload).toBe(5);
  });
});
