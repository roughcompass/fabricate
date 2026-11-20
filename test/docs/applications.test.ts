import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REF_LIMITS } from "@/lib/applications/preview-mode";
import { PAGE_SIZE } from "@/lib/applications/records";
import { loadConfig } from "@/lib/config";
import { DEVICES } from "@/lib/web/device-preview";

/*
 * docs/applications.md (add-applications task 10.6, a draft until the
 * toolbar's sections are written): every link and anchor resolves, and the
 * limits it states are the ones the pages keep.
 */

const FILE = "docs/applications.md";
const doc = fs.readFileSync(FILE, "utf8");

/** A heading's anchor, as GitHub and the docs site make it. */
const anchor = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[`*]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
const anchorsOf = (text: string) => new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map((match) => anchor(match[1]!)));

describe("docs/applications.md", () => {
  it("links only to files that exist, and to headings they have", () => {
    const links = [...doc.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]!).filter((target) => !/^[a-z]+:/.test(target));
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      const [file, fragment] = link.split("#");
      const target = file ? path.join(path.dirname(FILE), file) : FILE;
      expect(fs.existsSync(target), link).toBe(true);
      if (fragment) expect(anchorsOf(fs.readFileSync(target, "utf8")).has(fragment), link).toBe(true);
    }
  });

  it("states the limits the pages keep", () => {
    const { previews } = loadConfig({ appRoot: process.cwd(), environment: "production", env: {} });
    expect(doc).toContain(`(\`previews.refCacheSeconds\`, ${previews.refCacheSeconds} by default)`);
    expect(doc).toContain(`the remote's other branches by name, up to ${REF_LIMITS.branches}`);
    expect(doc).toContain(`the ${REF_LIMITS.tags} highest-numbered tags`);
    expect(doc).toContain(`up to ${REF_LIMITS.matches} matches`);
    expect(doc).toContain(`ordered by name, ${PAGE_SIZE} to a page`);
    for (const device of Object.values(DEVICES)) expect(doc).toContain(`**${device.label}** (${device.width} by ${device.height})`);
  });
});
