import { describe, expect, it } from "vitest";
import { filterCatalog, starterEntry } from "@/lib/applications/starter-catalog";
import { STARTERS_FILE, readStarters } from "@/lib/applications/starters";
import { EMPTY_QUERY } from "@/lib/demo/gallery";
import { TEMPLATES } from "@/lib/demo/catalog";

/*
 * The full catalog Browse all opens (application-creation spec, "Browse all
 * opens the full catalog on a full page"): the starters first, in the
 * starters file's order unless a search ranks them, then the templates.
 */

const committed = () => {
  const result = readStarters(STARTERS_FILE);
  if (!result.ok) throw new Error("the committed starters file must load");
  return result.starters.map(starterEntry);
};

describe("the starter catalog", () => {
  it("keeps the starters in file order, before the templates, without a search", () => {
    const templates = TEMPLATES.slice(0, 3).map((template) => ({ ...template, kind: "web" as const, starter: null }));
    const shown = filterCatalog([...committed(), ...templates], EMPTY_QUERY, []);
    expect(shown.map((entry) => entry.slug)).toEqual(["de-web-boilerplate", "salt-dashboard", "salt-starter", "agent-starter", ...shown.slice(4).map((entry) => entry.slug)]);
    expect(shown.slice(4).every((entry) => entry.starter === null)).toBe(true);
  });

  it("keeps file order within a Kind, and ranks starters by a search", () => {
    expect(filterCatalog(committed(), EMPTY_QUERY, ["web"]).map((entry) => entry.slug)).toEqual(["de-web-boilerplate", "salt-starter"]);
    expect(filterCatalog(committed(), { ...EMPTY_QUERY, search: "agent" }, []).map((entry) => entry.slug)[0]).toBe("agent-starter");
  });
});
