// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { parseThemeChoice, themeSwitch, usesNextTheme } from "@/components/toolbar/settings/theme";

/*
 * Settings' theme switch (restore-toolbar-tools-and-branch-previews, design
 * decision 9, task 11.2): Salt's mode attribute and density class set on
 * every provider element, kept through the application's re-renders, and
 * the application's own restored.
 */

/** The page as Salt's providers leave it: the root on <html>, and a remote's nested provider on its own element. */
function saltPage(next = false) {
  const theme = next ? "salt-theme-next" : "salt-theme";
  document.documentElement.className = `${theme} salt-density-medium`;
  document.documentElement.setAttribute("data-mode", "light");
  if (next) {
    document.documentElement.setAttribute("data-accent", "blue");
    document.documentElement.setAttribute("data-corner", "sharp");
  }
  document.body.innerHTML = `<main><div class="salt-provider ${theme} salt-density-medium" data-mode="light" id="nested"><p>Quotes panel</p></div></main>`;
  return { root: document.documentElement, nested: document.getElementById("nested")! };
}

/** Lets the page's observer run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const densities = (element: Element) => [...element.classList].filter((name) => name.startsWith("salt-density-"));

beforeEach(() => {
  document.documentElement.removeAttribute("class");
  for (const name of ["data-mode", "data-accent", "data-corner"]) document.documentElement.removeAttribute(name);
});

describe("the theme switch", () => {
  it("sets dark mode and a density on the root provider and a nested one, without touching anything else", () => {
    const { root, nested } = saltPage();
    const applied = themeSwitch(document, { mode: "dark", density: "high" });
    for (const element of [root, nested]) {
      expect(element.getAttribute("data-mode")).toBe("dark");
      expect(densities(element)).toEqual(["salt-density-high"]);
      expect(element.classList.contains("salt-theme")).toBe(true);
    }
    expect(nested.classList.contains("salt-provider")).toBe(true);
    applied.stop();
  });

  it("keeps the choice when the application renders its providers again, or adds a provider", async () => {
    const { root, nested } = saltPage();
    const applied = themeSwitch(document, { mode: "dark", density: "touch" });
    // The application's provider writes its own theme back, as a re-render does.
    root.className = "salt-theme salt-density-medium";
    nested.setAttribute("data-mode", "light");
    const added = document.createElement("div");
    added.className = "salt-theme salt-density-low";
    added.setAttribute("data-mode", "light");
    document.body.append(added);
    await settle();
    for (const element of [root, nested, added]) {
      expect(element.getAttribute("data-mode")).toBe("dark");
      expect(densities(element)).toEqual(["salt-density-touch"]);
    }
    applied.stop();
  });

  it("restores what the application gave each provider when its own is chosen, setting by setting", async () => {
    const { root, nested } = saltPage();
    const applied = themeSwitch(document, { mode: "dark", density: "high" });
    applied.update({ density: "high" });
    expect(root.getAttribute("data-mode")).toBe("light");
    expect(nested.getAttribute("data-mode")).toBe("light");
    expect(densities(root)).toEqual(["salt-density-high"]);
    applied.update({});
    expect(densities(root)).toEqual(["salt-density-medium"]);
    // With nothing chosen, the application's own changes stand.
    root.setAttribute("data-mode", "dark");
    await settle();
    expect(root.getAttribute("data-mode")).toBe("dark");
    applied.stop();
  });

  it("sets the next theme's accent and corner, only on its providers", () => {
    const { root } = saltPage(true);
    expect(usesNextTheme(document)).toBe(true);
    const applied = themeSwitch(document, { accent: "teal", corner: "rounded" });
    expect([root.getAttribute("data-accent"), root.getAttribute("data-corner")]).toEqual(["teal", "rounded"]);
    applied.stop();
    expect([root.getAttribute("data-accent"), root.getAttribute("data-corner")]).toEqual(["blue", "sharp"]);
  });

  it("reads only Salt's settings and values from a stored or shared choice", () => {
    expect(parseThemeChoice({ mode: "dark", density: "high", accent: "teal", corner: "rounded" })).toEqual({ mode: "dark", density: "high", accent: "teal", corner: "rounded" });
    expect(parseThemeChoice({ mode: "sepia", density: 3, other: "x" })).toEqual({});
    expect(parseThemeChoice(null)).toEqual({});
  });
});
