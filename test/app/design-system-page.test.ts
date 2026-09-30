import { afterEach, describe, expect, it, vi } from "vitest";
import DesignSystemPage from "@/app/design-system/page";
import { redirectOf } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

describe("component gallery", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("responds with the not-found page in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await redirectOf(DesignSystemPage({ searchParams: Promise.resolve({}) }))).toBe("not-found");
  });

  it("renders in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await expect(DesignSystemPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
  });
});
