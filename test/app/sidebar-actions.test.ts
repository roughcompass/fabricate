import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSidebarVisibility } from "@/app/sidebar-actions";

const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options?: Record<string, unknown>) => jar.set(name, { value, options }),
    delete: (name: string) => jar.delete(name),
  }),
}));

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

// operator-interface/page-patterns spec: hiding the sidebar works without JavaScript.
describe("setSidebarVisibility", () => {
  beforeEach(() => jar.clear());

  it("stores the hidden state for a year, readable by the browser", async () => {
    await setSidebarVisibility(form({ sidebar: "hidden" }));
    expect(jar.get("fabricate-sidebar")).toEqual({ value: "hidden", options: { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" } });
    expect(jar.get("fabricate-sidebar")?.options).not.toHaveProperty("httpOnly");
  });

  it("clears it to show the sidebar again", async () => {
    await setSidebarVisibility(form({ sidebar: "hidden" }));
    await setSidebarVisibility(form({ sidebar: "shown" }));
    expect(jar.has("fabricate-sidebar")).toBe(false);
  });

  it("treats anything else as shown", async () => {
    await setSidebarVisibility(form({ sidebar: "hidden" }));
    await setSidebarVisibility(form({}));
    expect(jar.has("fabricate-sidebar")).toBe(false);
  });
});
