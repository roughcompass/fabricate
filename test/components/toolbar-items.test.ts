import { describe, expect, it } from "vitest";
import { ITEM_GROUPS, TOOLBAR_ITEMS, TOOLS, activeItemFor, bestMatch, itemForKey, keyLabel, matchItems } from "@/components/toolbar/toolbar-context";

// template-demo/toolbar spec: Comment, Comments, Share, Accessibility, and Timing (add-applications, task 8.5), with Microfrontends,
// Session, and Settings restored (restore-toolbar-tools-and-branch-previews, task 8.1), and Data (add-mock-sets, task 10.1).
describe("toolbar items", () => {
  it("gives each action the fixed key the spec lists, with no key used twice", () => {
    const keys = Object.fromEntries(TOOLBAR_ITEMS.filter((item) => item.key).map((item) => [keyLabel(item.key!), item.id]));
    expect(keys).toEqual({ C: "comment", M: "microfrontends", A: "accessibility", T: "timing", P: "session", D: "data", S: "settings", L: "share", ".": "hide", "?": "shortcuts" });
    const all = TOOLBAR_ITEMS.flatMap((item) => (item.key ? [item.key] : []));
    expect(new Set(all).size).toBe(all.length);
  });

  it("lists the groups in order, each with its items", () => {
    const groups = [...new Set(TOOLBAR_ITEMS.map((item) => item.group))];
    expect(groups).toEqual([...ITEM_GROUPS]);
    expect(groups).toEqual(["Collaboration", "Inspect", "Runtime", "More"]);
    const byGroup = Object.fromEntries(ITEM_GROUPS.map((group) => [group, TOOLBAR_ITEMS.filter((item) => item.group === group).map((item) => item.name)]));
    expect(byGroup).toEqual({
      Collaboration: ["Comment", "Comments", "Share"],
      Inspect: ["Microfrontends", "Accessibility", "Timing"],
      Runtime: ["Session", "Data", "Settings"],
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
    // The restored tools, by their names and by the words the spec lists.
    expect(matchItems("micro").map((item) => item.name)).toEqual(["Microfrontends"]);
    expect(matchItems("session").map((item) => item.name)).toEqual(["Session"]);
    for (const word of ["mfe", "routing"]) expect(matchItems(word).map((item) => item.name), word).toEqual(["Microfrontends"]);
    for (const word of ["storage", "cookies"]) expect(matchItems(word).map((item) => item.name), word).toEqual(["Session"]);
    for (const word of ["dark", "density", "events", "theme"]) expect(matchItems(word).map((item) => item.name), word).toEqual(["Settings"]);
    // Data, by the words of design decision 15; "har" is in Share's name too, but Data is the one highlighted.
    for (const word of ["mock", "mocks", "mock set", "api", "network", "requests", "fixtures", "stub", "latency"]) expect(matchItems(word).map((item) => item.name), word).toEqual(["Data"]);
    expect(matchItems("har").map((item) => item.name)).toEqual(["Share", "Data"]);
    expect(bestMatch("har", matchItems("har"))?.name).toBe("Data");
    expect(bestMatch("sh", matchItems("sh"))?.name).toBe("Share");
    // Environments were simulations, and aren't offered.
    expect(matchItems("environment")).toEqual([]);
    expect(matchItems("zzz")).toEqual([]);
    expect(matchItems("  ")).toHaveLength(TOOLBAR_ITEMS.length);
  });

  it("finds an item by its key, and names the pill's active item", () => {
    expect(itemForKey("A")?.id).toBe("accessibility");
    expect(itemForKey("m")?.id).toBe("microfrontends");
    expect(itemForKey("P")?.id).toBe("session");
    expect(itemForKey("s")?.id).toBe("settings");
    expect(itemForKey("D")?.id).toBe("data");
    expect(itemForKey("?")?.id).toBe("shortcuts");
    expect(itemForKey("x")).toBeUndefined();
    expect(activeItemFor(null, "comment")?.id).toBe("comment");
    expect(activeItemFor("timing", "none")?.id).toBe("timing");
    expect(activeItemFor(null, "select")?.id).toBe("microfrontends");
    expect(activeItemFor(null, "none")).toBeNull();
  });
});
