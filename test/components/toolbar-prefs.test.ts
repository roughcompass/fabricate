import { describe, expect, it } from "vitest";
import { parseToolbarPrefs } from "@/components/toolbar/toolbar-prefs";

/*
 * The toolbar's stored preferences: whether it's collapsed and whether
 * single-key shortcuts are on. Preferences nothing reads any longer, the
 * template demo's zone indicator and debug mode, are ignored in what a
 * browser already stored, without an error.
 */

describe("toolbar preferences", () => {
  it("reads the ones the toolbar uses, ignoring the template demo's zone indicator and debug mode", () => {
    expect(parseToolbarPrefs(JSON.stringify({ collapsed: true, zoneIndicator: true, debug: true, shortcuts: false }))).toEqual({ collapsed: true, shortcuts: false });
    expect(parseToolbarPrefs(JSON.stringify({ zoneIndicator: true, debug: true }))).toEqual({ collapsed: false, shortcuts: true });
  });

  it("falls back to the defaults for nothing stored, or what can't be read", () => {
    for (const stored of [null, "", "not json", "null", "[]"]) expect(parseToolbarPrefs(stored)).toEqual({ collapsed: false, shortcuts: true });
  });
});
