import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WHATS_INCLUDED_FILE, readWhatsIncluded, whatsIncluded } from "@/lib/onboarding/whats-included";
import { itemsFor } from "@/lib/onboarding/whats-included-items";

/*
 * The "What's included" content (add-portal-switcher task 2.2): the committed
 * file loads, a broken file is reported with where it broke, and items
 * follow the chosen platform.
 */

describe("the committed content file", () => {
  it("matches the expected shape", () => {
    const result = readWhatsIncluded(WHATS_INCLUDED_FILE);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.content.items.length).toBeGreaterThan(0);
  });
});

describe("readWhatsIncluded", () => {
  let directory: string;
  const write = (source: string) => {
    const file = path.join(directory, "whats-included.yaml");
    fs.writeFileSync(file, source);
    return file;
  };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "whats-included-"));
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it("reads items in file order, with badges, platforms, and a link", () => {
    const file = write(`title: What's included
items:
  - title: Environments
    description: From the catalog
  - title: Release notes
    description: For phones
    badge: new
    platforms: [mobile]
link:
  label: Learn more about Portal onboarding
  href: https://docs.example.com/portals
`);
    expect(readWhatsIncluded(file)).toEqual({
      ok: true,
      content: {
        title: "What's included",
        items: [
          { title: "Environments", description: "From the catalog" },
          { title: "Release notes", description: "For phones", badge: "new", platforms: ["mobile"] },
        ],
        link: { label: "Learn more about Portal onboarding", href: "https://docs.example.com/portals" },
      },
    });
  });

  it("reports a missing file", () => {
    expect(readWhatsIncluded(path.join(directory, "missing.yaml"))).toMatchObject({ ok: false, problem: expect.stringMatching(/missing\.yaml can't be read/) });
  });

  it("reports invalid YAML", () => {
    expect(readWhatsIncluded(write("items: [unclosed"))).toMatchObject({ ok: false, problem: expect.stringMatching(/isn't valid YAML/) });
  });

  it.each([
    ["an item without a title", "title: T\nitems:\n  - description: D\n", "items.0.title"],
    ["an unknown platform", "title: T\nitems:\n  - title: A\n    description: D\n    platforms: [kiosk]\n", "items.0.platforms.0"],
    ["a link that isn't https", "title: T\nitems:\n  - title: A\n    description: D\nlink:\n  label: L\n  href: http://docs.example.com\n", "link.href"],
    ["an unknown field", "title: T\nitems:\n  - title: A\n    description: D\n    icon: star\n", "items.0"],
    ["no items", "title: T\nitems: []\n", "items"],
  ])("reports %s with its field path", (_name, source, at) => {
    const result = readWhatsIncluded(write(source));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain(` at ${at}:`);
  });

  it("reports the committed malformed fixture", () => {
    expect(readWhatsIncluded("test/fixtures/onboarding/whats-included-malformed.yaml")).toMatchObject({ ok: false, problem: expect.stringContaining("at items.0.title") });
  });
});

describe("whatsIncluded", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns the content, or null and one logged problem for a broken file", () => {
    expect(whatsIncluded()?.title).toBe("What's included");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("FABRICATE_WHATS_INCLUDED_FILE", "test/fixtures/onboarding/whats-included-malformed.yaml");
    expect(whatsIncluded()).toBeNull();
    expect(whatsIncluded()).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toContain("whats-included-malformed.yaml at items.0.title");
  });
});

describe("itemsFor", () => {
  const items = [
    { title: "Everywhere", description: "D" },
    { title: "Phones", description: "D", platforms: ["mobile" as const] },
    { title: "Screens", description: "D", platforms: ["web" as const, "desktop" as const] },
  ];

  it("shows only items without platforms before a platform is chosen", () => {
    expect(itemsFor(items, null).map((item) => item.title)).toEqual(["Everywhere"]);
  });

  it.each([
    ["web", ["Everywhere", "Screens"]],
    ["mobile", ["Everywhere", "Phones"]],
    ["desktop", ["Everywhere", "Screens"]],
  ] as const)("shows the items for %s", (platform, titles) => {
    expect(itemsFor(items, platform).map((item) => item.title)).toEqual(titles);
  });
});
