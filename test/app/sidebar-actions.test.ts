import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSidebarVisibility } from "@/app/sidebar-actions";
import { formData } from "../support/next";

const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options?: Record<string, unknown>) => jar.set(name, { value, options }),
    delete: (name: string) => jar.delete(name),
  }),
}));

// operator-interface/page-patterns spec: hiding the sidebar works without JavaScript.
describe("setSidebarVisibility", () => {
  beforeEach(() => jar.clear());

  it("stores the hidden state for a year, readable by the browser", async () => {
    await setSidebarVisibility(formData({ sidebar: "hidden" }));
    expect(jar.get("frontend-registry-sidebar")).toEqual({ value: "hidden", options: { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" } });
    expect(jar.get("frontend-registry-sidebar")?.options).not.toHaveProperty("httpOnly");
  });

  it("clears it to show the sidebar again", async () => {
    await setSidebarVisibility(formData({ sidebar: "hidden" }));
    await setSidebarVisibility(formData({ sidebar: "shown" }));
    expect(jar.has("frontend-registry-sidebar")).toBe(false);
  });

  it("clears the cookie's name from before the rename too", async () => {
    jar.set("fabricate-sidebar", { value: "hidden" });
    await setSidebarVisibility(formData({ sidebar: "shown" }));
    expect(jar.has("fabricate-sidebar")).toBe(false);
  });

  it("treats anything else as shown", async () => {
    await setSidebarVisibility(formData({ sidebar: "hidden" }));
    await setSidebarVisibility(formData({}));
    expect(jar.has("frontend-registry-sidebar")).toBe(false);
  });
});
