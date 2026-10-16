import { Button, Tab, TabBar, Table, Tabs, TabTrigger, TBody, TD, TR } from "@salt-ds/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { componentLabel, describeElement, nearestComponent, saltComponentOf } from "@/prototypes/runtime/inspector";

/**
 * Contract test for the element inspector (design.md, risks: Salt's internal
 * class names are fragile). It reads the class names the installed Salt
 * release really renders, and resolves component names from them.
 */

interface FakeElement {
  readonly tagName: string;
  readonly classList: string[];
  parentElement: FakeElement | null;
  readonly textContent: string;
  readonly innerText: string;
  readonly children: FakeElement[];
  getAttribute(name: string): string | null;
  contains(other: FakeElement): boolean;
}

/** The tag and classes of every element in a markup string, nested in order, as minimal elements. */
function elementsOf(markup: string, text = ""): FakeElement[] {
  const all: FakeElement[] = [];
  const stack: FakeElement[] = [];
  for (const match of markup.matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>/g)) {
    const [, closing, tag, attributes, selfClosing] = match;
    if (closing) {
      stack.pop();
      continue;
    }
    const classes = /class="([^"]*)"/.exec(attributes!)?.[1]?.split(" ") ?? [];
    const role = /role="([^"]*)"/.exec(attributes!)?.[1] ?? null;
    const element: FakeElement = {
      tagName: tag!.toUpperCase(),
      classList: classes,
      parentElement: stack.at(-1) ?? null,
      textContent: text,
      innerText: text,
      children: [],
      getAttribute: (name) => (name === "role" ? role : null),
      contains(other) {
        for (let node: FakeElement | null = other; node; node = node.parentElement) if (node === this) return true;
        return false;
      },
    };
    element.parentElement?.children.push(element);
    all.push(element);
    if (!selfClosing) stack.push(element);
  }
  return all;
}

const asElement = (element: FakeElement) => element as unknown as Element;

describe("element inspector", () => {
  it("names Button, Table, and Tabs from the installed release's class names", () => {
    const [button] = elementsOf(renderToStaticMarkup(<Button>Approve</Button>));
    expect(saltComponentOf(asElement(button!))).toBe("Button");

    const table = elementsOf(renderToStaticMarkup(
      <Table>
        <TBody>
          <TR>
            <TD>Northwind Logistics</TD>
          </TR>
        </TBody>
      </Table>,
    ));
    const cell = table.find((element) => element.tagName === "TD")!;
    expect(nearestComponent(asElement(cell), asElement(table[0]!)).name).toBe("Table");

    const tabs = elementsOf(renderToStaticMarkup(
      <Tabs defaultValue="payments">
        <TabBar>
          <Tab value="payments">
            <TabTrigger>Payments</TabTrigger>
          </Tab>
        </TabBar>
      </Tabs>,
    ));
    expect(saltComponentOf(asElement(tabs[0]!))).toBe("Tabs");
  });

  it("reads multi-word components as Salt's documentation names them", () => {
    expect(componentLabel("TokenizedInput")).toBe("Tokenized input");
    expect(componentLabel("StatusIndicator")).toBe("Status indicator");
    expect(componentLabel("Button")).toBe("Button");
  });

  it("falls back to the element's role and text when no component name resolves", () => {
    const [root, element] = elementsOf('<div><p role="note"></p></div>', "Cut-off at 14:30 ET");
    const described = describeElement(asElement(element!), asElement(root!));
    expect(described).toMatchObject({ component: "note", text: "Cut-off at 14:30 ET" });
    const [plainRoot, plain] = elementsOf("<div><span></span></div>", "Pending");
    expect(describeElement(asElement(plain!), asElement(plainRoot!)).component).toBe("span");
  });
});
