import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REF_LIMITS } from "@/lib/applications/preview-mode";
import { PAGE_SIZE } from "@/lib/applications/records";
import { loadConfig } from "@/lib/config";
import { DEVICES } from "@/lib/web/device-preview";
import { COMMENT_LIMIT, THREAD_LIMIT } from "@/lib/workspaces/workspaces";
import { DESCRIPTION_LIMIT, MB, NAME_LIMIT, RESPONSE_BODY_LIMIT, RESPONSE_LIMIT, RULE_LIMIT, SET_BODY_LIMIT, SET_LIMIT } from "@/lib/mocks/model";
import { HAR_ENTRY_LIMIT, HAR_UPLOAD_LIMIT, IMPORT_BODY_LIMIT } from "@/lib/mocks/har-import";
import { CREDENTIAL_HEADER, CREDENTIAL_NAME, JWT_PLACEHOLDER, TRANSPORT_HEADERS } from "@/lib/mocks/sanitize";
import { DRAFT_HOURS, REVIEW_PAGE_SIZE } from "@/lib/mocks/imports";
import { EXPORT_ORIGIN } from "@/lib/mocks/export";
import { OPERATIONS_SHOWN, SERVICES_SHOWN } from "@/lib/mocks/profile-apis";
import { FAILED_CALL_KINDS } from "@/lib/db/schema";
import { TOOLBAR_ITEMS } from "@/components/toolbar/toolbar-context";

/*
 * docs/applications.md (add-applications task 10.6): every link and anchor
 * resolves, the limits it states are the ones the pages and workspaces keep,
 * and it lists every toolbar tool with its key.
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
    expect(doc).toContain(`up to ${COMMENT_LIMIT.toLocaleString("en-US")} characters`);
    expect(doc).toContain(`a workspace up to ${THREAD_LIMIT} open threads`);
  });

  it("states the mock set limits the records keep (add-mock-sets)", () => {
    expect(doc).toContain(`an application can have ${SET_LIMIT} mock sets;`);
    expect(doc).toContain(`a set can have ${RULE_LIMIT} rules, and its responses can hold ${SET_BODY_LIMIT / MB} MB in all;`);
    expect(doc).toContain(`a rule can have ${RESPONSE_LIMIT} responses, and a response's body up to ${RESPONSE_BODY_LIMIT / MB} MB;`);
    expect(doc).toContain(`a name of up to ${NAME_LIMIT} characters, unique among the application's sets ignoring case, and an optional description of up to ${DESCRIPTION_LIMIT} characters`);
  });

  it("quotes the upload's limits, and the headers and patterns sanitizing removes, as the code has them (add-mock-sets, task 3.7)", () => {
    expect(doc).toContain(`of up to ${HAR_UPLOAD_LIMIT / MB} MB and ${HAR_ENTRY_LIMIT.toLocaleString("en-US")} entries`);
    expect(doc).toContain(`bodies over ${IMPORT_BODY_LIMIT / MB} MB`);
    expect(doc).toContain(`\`${String(CREDENTIAL_HEADER)}\``);
    expect(doc).toContain(`\`${String(CREDENTIAL_NAME)}\``);
    expect(doc).toContain(`\`${JWT_PLACEHOLDER}\``);
    const quoted = [...doc.matchAll(/the transport headers that no longer apply: (.+?)\.\n/g)][0]![1]!.match(/`([^`]+)`/g)!.map((name) => name.slice(1, -1).toLowerCase());
    expect(new Set(quoted)).toEqual(new Set(TRANSPORT_HEADERS));
    expect(doc).toContain(`for ${DRAFT_HOURS} hours`);
    expect(doc).toContain(`by host, ${REVIEW_PAGE_SIZE} to a page`);
    expect(doc).toContain(`up to ${RESPONSE_LIMIT}; a rule called more often keeps the first ${RESPONSE_LIMIT - 1} and the last`);
    expect(doc).toContain(`\`${EXPORT_ORIGIN}\``);
  });

  it("describes onboarding's Data step in the step's own words (add-mock-sets, task 6.2)", () => {
    const step = fs.readFileSync("src/app/(operator)/applications/new/data-step.tsx", "utf8");
    for (const words of ["Skip for now", "isn't available yet", "a static preview can't reach"]) {
      expect(step, words).toContain(words);
      expect(doc, words).toContain(words);
    }
    expect(doc).toContain(`up to ${SERVICES_SHOWN} of the APIs the code calls, each with its client and up to ${OPERATIONS_SHOWN} of its operations`);
  });

  it("quotes the failure kinds a capture records as screenshot_failed_calls.kind has them (add-mock-sets, task 7.4)", () => {
    const quoted = [...doc.matchAll(/\(`(status|connect|cors|not_mocked|websocket|[a-z_]+)`\)/g)].map((match) => match[1]);
    expect(new Set(quoted)).toEqual(new Set(FAILED_CALL_KINDS));
  });

  it("lists every toolbar tool with its key", () => {
    for (const item of TOOLBAR_ITEMS) expect(doc, item.name).toContain(item.key ? `| **${item.name}** | ${item.key.toUpperCase()} |` : `| **${item.name}** | |`);
  });
});
