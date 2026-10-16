import { beforeEach, describe, expect, it, vi } from "vitest";
import { rememberActor, rememberedActor } from "@/lib/web/actor-cookie";

const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => jar.set(name, { value, options }),
  }),
}));

// add-portal-switcher design decision 9: the Create Portal dialog opens on any page, so the remembered name is readable everywhere.
describe("the remembered actor", () => {
  beforeEach(() => jar.clear());

  it("is kept for 90 days across the whole app, out of the browser's reach", async () => {
    await rememberActor("  Jane Rivera ");
    expect(jar.get("fabricate-actor")).toEqual({ value: "Jane Rivera", options: { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 } });
    expect(await rememberedActor()).toBe("Jane Rivera");
  });

  it("keeps nothing for a blank name", async () => {
    await rememberActor("   ");
    expect(jar.has("fabricate-actor")).toBe(false);
    expect(await rememberedActor()).toBe("");
  });
});
