import { describe, expect, it } from "vitest";
import { ITEM_GROUPS, TOOLBAR_ITEMS, TOOLS, activeItemFor, itemForKey, keyLabel, matchItems } from "@/components/toolbar/toolbar-context";

// template-demo/toolbar spec: the tools are Comment, Comments, Share, Accessibility, and Timing (add-applications, task 8.5).
describe("toolbar items", () => {
  it("gives each action the fixed key the spec lists, with no key used twice", () => {
    const keys = Object.fromEntries(TOOLBAR_ITEMS.filter((item) => item.key).map((item) => [keyLabel(item.key!), item.id]));
    expect(keys).toEqual({ C: "comment", A: "accessibility", T: "timing", L: "share", ".": "hide", "?": "shortcuts" });
    const all = TOOLBAR_ITEMS.flatMap((item) => (item.key ? [item.key] : []));
    expect(new Set(all).size).toBe(all.length);
  });

  it("lists the groups in order, each with its items", () => {
    const groups = [...new Set(TOOLBAR_ITEMS.map((item) => item.group))];
    expect(groups).toEqual([...ITEM_GROUPS]);
    expect(groups).toEqual(["Collaboration", "Inspect", "More"]);
    const byGroup = Object.fromEntries(ITEM_GROUPS.map((group) => [group, TOOLBAR_ITEMS.filter((item) => item.group === group).map((item) => item.name)]));
    expect(byGroup).toEqual({
      Collaboration: ["Comment", "Comments", "Share"],
      Inspect: ["Accessibility", "Timing"],
      More: ["Keyboard shortcuts", "Hide toolbar"],
    });
  });

  it("has an item for every tool, and keeps comment mode and the comments list separate", () => {
    for (const tool of TOOLS) expect(TOOLBAR_ITEMS.some((item) => item.action.kind === "tool" && item.action.tool === tool), tool).toBe(true);
    expect(TOOLBAR_ITEMS.find((item) => item.id === "comment")!.action).toEqual({ kind: "mode", mode: "comment" });
    expect(TOOLBAR_ITEMS.find((item) => item.id === "comments")!.action).toEqual({ kind: "tool", tool: "comments" });
  });

  it("matches names and aliases, ignoring case", () => {
    expect(matchItems("a11y").map((item) => item.name)).toEqual(["Accessibility"]);
    expect(matchItems("TIM").map((item) => item.name)).toEqual(["Timing"]);
    expect(matchItems("vitals").map((item) => item.name)).toEqual(["Timing"]);
    // The removed tools are gone from the search too.
    expect(matchItems("persona")).toEqual([]);
    expect(matchItems("micro")).toEqual([]);
    expect(matchItems("theme")).toEqual([]);
    expect(matchItems("zzz")).toEqual([]);
    expect(matchItems("  ")).toHaveLength(TOOLBAR_ITEMS.length);
  });

  it("finds an item by its key, and names the pill's active item", () => {
    expect(itemForKey("A")?.id).toBe("accessibility");
    expect(itemForKey("p")).toBeUndefined();
    expect(itemForKey("m")).toBeUndefined();
    expect(itemForKey("s")).toBeUndefined();
    expect(itemForKey("?")?.id).toBe("shortcuts");
    expect(itemForKey("x")).toBeUndefined();
    expect(activeItemFor(null, "comment")?.id).toBe("comment");
    expect(activeItemFor("timing", "none")?.id).toBe("timing");
    expect(activeItemFor(null, "none")).toBeNull();
  });
});
