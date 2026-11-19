import { describe, expect, it } from "vitest";
import { type NewThread, sessionThreadStore } from "@/components/toolbar/comments/thread-store";

/*
 * The test run page's comment threads, kept in the browser tab
 * (add-applications, task 8.2): each records its route, commit, and element,
 * and comments follow the workspace's rules for names and length.
 */

function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
}

const thread = (overrides: Partial<NewThread> = {}): NewThread => ({
  route: "/accounts",
  commit: "a".repeat(40),
  anchor: { path: "#content > div > button:nth-of-type(2)", tag: "button", fingerprint: "Export orders" },
  offsetX: 0.5,
  offsetY: 0.25,
  body: "Make this primary",
  ...overrides,
});

describe("the session thread store", () => {
  it("asks for a name and a comment the first time, then remembers the name", async () => {
    const storage = memoryStorage();
    const store = sessionThreadStore("threads", () => storage);
    expect(await store.create(thread({ body: "   " }))).toEqual({ ok: false, errors: { authorName: ["Enter a display name"], body: ["Write a comment"] } });

    const created = await store.create(thread({ authorName: "  Sam   Rivera " }));
    expect(created).toMatchObject({ ok: true, displayName: "Sam Rivera" });
    const id = created.ok ? created.id! : "";
    expect(id).toMatch(/^thr_/);
    const second = await store.create(thread({ route: "/settings", body: "Second" }));
    expect(second.ok && second.threads.map((placed) => [placed.route, placed.comments[0]!.authorName])).toEqual([
      ["/accounts", "Sam Rivera"],
      ["/settings", "Sam Rivera"],
    ]);

    // Another store over the same storage, as after a reload, reads them back with their place.
    const reloaded = await sessionThreadStore("threads", () => storage).load();
    expect(reloaded.displayName).toBe("Sam Rivera");
    expect(reloaded.threads[0]).toMatchObject({ id, route: "/accounts", commit: "a".repeat(40), anchor: { fingerprint: "Export orders" }, offsetX: 0.5, offsetY: 0.25, status: "open" });
  });

  it("refuses a comment over the limit", async () => {
    const store = sessionThreadStore("threads", memoryStorage);
    expect(await store.create(thread({ authorName: "Sam", body: "x".repeat(2001) }))).toEqual({ ok: false, errors: { body: ["Use at most 2,000 characters"] } });
  });

  it("replies to, resolves, and reopens a thread it has, and refuses one it doesn't", async () => {
    const storage = memoryStorage();
    const store = sessionThreadStore("threads", () => storage);
    const created = await store.create(thread({ authorName: "Sam" }));
    const id = created.ok ? created.id! : "";
    const replied = await store.reply(id, "Agreed\r\nship it", "Robin");
    expect(replied.ok && replied.threads[0]!.comments.map((comment) => [comment.authorName, comment.body])).toEqual([
      ["Sam", "Make this primary"],
      ["Robin", "Agreed\nship it"],
    ]);
    expect((await store.setStatus(id, "resolved")).ok && (await store.load()).threads[0]!.status).toBe("resolved");
    expect((await store.setStatus(id, "open")).ok && (await store.load()).threads[0]!.status).toBe("open");
    expect(await store.reply("thr_missing", "Hello")).toEqual({ ok: false, errors: { body: ["This comment thread does not exist"] } });
    expect(await store.setStatus("thr_missing", "resolved")).toEqual({ ok: false, errors: { body: ["This comment thread does not exist"] } });
  });

  it("starts empty when what's stored can't be read", async () => {
    const storage = memoryStorage();
    storage.setItem("threads", "{not json");
    expect(await sessionThreadStore("threads", () => storage).load()).toEqual({ threads: [], displayName: null });
  });
});
