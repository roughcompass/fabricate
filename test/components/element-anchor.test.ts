import { describe, expect, it } from "vitest";
import { type AnchorElement, anchorFor, commentTarget, describeAnchor, findAnchored, fingerprintOf, pathOf } from "@/components/toolbar/comments/element-anchor";

/*
 * Comment anchors on a running application's own elements (add-applications,
 * design decision 6): a CSS path, the tag, and a text fingerprint, found
 * again by the path and confirmed by the rest.
 */

/** Enough of a DOM element for anchoring, with a selector engine for the paths anchors write. */
class Fake implements AnchorElement {
  readonly children: Fake[] = [];
  parentElement: Fake | null = null;

  constructor(
    readonly tagName: string,
    readonly attributes: Record<string, string> = {},
    readonly text = "",
  ) {}

  get id(): string {
    return this.attributes.id ?? "";
  }

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  append(...children: Fake[]): this {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
    return this;
  }

  /** Only the control selector commentTarget asks for. */
  closest(): Fake | null {
    const control = ["BUTTON", "INPUT", "LABEL"].includes(this.tagName) || (this.tagName === "A" && Boolean(this.attributes.href));
    return control ? this : (this.parentElement?.closest() ?? null);
  }
}

const el = (tag: string, attributes: Record<string, string> = {}, text = "") => new Fake(tag.toUpperCase(), attributes, text);

function descendants(node: Fake): Fake[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

/** A document over +body+ that resolves `#id` and `tag:nth-of-type(n)` paths joined by ` > `. */
function documentOf(body: Fake) {
  const all = () => [body, ...descendants(body)];
  return {
    querySelectorAll: (selector: string) => all().filter((node) => `#${node.id}` === selector),
    querySelector(selector: string): Fake | null {
      if (selector.includes("[")) throw new SyntaxError(`Unsupported selector ${selector}`);
      let current: Fake[] = [];
      for (const [index, segment] of selector.split(" > ").entries()) {
        const match = /^(?:#([\w-]+)|([a-z0-9]+)(?::nth-of-type\((\d+)\))?)$/.exec(segment);
        if (!match) return null;
        if (match[1]) current = all().filter((node) => node.id === match[1]);
        else if (index === 0 && match[2] === "body") current = [body];
        else
          current = current.flatMap((parent) => {
            const same = parent.children.filter((child) => child.tagName === match[2]!.toUpperCase());
            return match[3] ? (same[Number(match[3]) - 1] ? [same[Number(match[3]) - 1]!] : []) : same.slice(0, 1);
          });
      }
      return current[0] ?? null;
    },
  };
}

function page() {
  const exportButton = el("button", {}, "Export orders");
  const recalculate = el("button", {}, "Recalculate totals");
  const icon = el("svg");
  const label = el("span", {}, "Download");
  const download = el("button", { "aria-label": "Download CSV" }).append(icon, label);
  const search = el("input", { type: "search" });
  const actions = el("div").append(search, recalculate, exportButton, download);
  const main = el("main", { id: "content" }).append(el("h1", {}, "Accounts"), actions);
  const generated = el("div", { id: ":r1:" }).append(el("p", {}, "First"), el("p", {}, "Second"));
  const body = el("body").append(el("header").append(el("p", {}, "Orders portal")), main, generated);
  return { body, document: documentOf(body), exportButton, recalculate, download, icon, label, search, generated };
}

describe("anchoring a comment to an element", () => {
  it("writes a path from the nearest stable, unique id, numbering siblings of the same tag", () => {
    const { document, exportButton, search } = page();
    expect(pathOf(exportButton, document)).toBe("#content > div > button:nth-of-type(2)");
    expect(pathOf(search, document)).toBe("#content > div > input");
  });

  it("leaves out ids a framework generates, and starts at the body without one", () => {
    const { document, generated } = page();
    expect(pathOf(generated.children[1]!, document)).toBe("body > div > p:nth-of-type(2)");
  });

  it("uses an id only when it's unique in the page", () => {
    const { body, document, exportButton } = page();
    body.append(el("section", { id: "content" }));
    expect(pathOf(exportButton, document)).toBe("body > main > div > button:nth-of-type(2)");
  });

  it("fingerprints an element by its name, else the start of its text, else its type", () => {
    const { exportButton, download, search } = page();
    expect(fingerprintOf(exportButton)).toBe("Export orders");
    expect(fingerprintOf(download)).toBe("Download CSV");
    expect(fingerprintOf(search)).toBe("search");
    expect(fingerprintOf(el("p", {}, `  A   very ${"long ".repeat(30)}`))).toHaveLength(64);
  });

  it("comments on the control around what was chosen", () => {
    const { icon, label, download, exportButton } = page();
    expect(commentTarget(icon)).toBe(download);
    expect(commentTarget(label)).toBe(download);
    expect(commentTarget(exportButton)).toBe(exportButton);
    const heading = el("h1", {}, "Accounts");
    expect(commentTarget(heading)).toBe(heading);
  });

  it("finds the element again by its path, confirmed by its tag and fingerprint", () => {
    const { document, exportButton } = page();
    const anchor = anchorFor(exportButton, document);
    expect(anchor).toEqual({ path: "#content > div > button:nth-of-type(2)", tag: "button", fingerprint: "Export orders" });
    expect(findAnchored(document, anchor)).toBe(exportButton);
    expect(describeAnchor(anchor)).toBe('button "Export orders"');
  });

  it("finds nothing rather than the wrong element when the page changed", () => {
    const { document, exportButton } = page();
    const anchor = anchorFor(exportButton, document);
    // A newer build renamed the button: same path, another fingerprint.
    const renamed = page();
    (renamed.exportButton as { text: string }).text = "Download orders";
    expect(findAnchored(renamed.document, anchor)).toBeNull();
    // Another tag at the path, no element there, or a path that isn't a selector.
    expect(findAnchored(document, { ...anchor, tag: "a" })).toBeNull();
    expect(findAnchored(document, { ...anchor, path: "#content > div > button:nth-of-type(9)" })).toBeNull();
    expect(findAnchored(document, { ...anchor, path: "[unbalanced" })).toBeNull();
  });
});
