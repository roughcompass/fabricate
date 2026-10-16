import { describe, expect, it } from "vitest";
import { SLUG, deriveSlug, slugCharacters } from "@/lib/onboarding/slug";

/* Portal slugs (add-portal-switcher task 1.1): derived from the name, lowercase letters only. */

describe("deriveSlug", () => {
  it("removes spaces and lowercases", () => {
    expect(deriveSlug("My New Portal")).toBe("mynewportal");
  });

  it("folds accents and removes digits", () => {
    expect(deriveSlug("Café Markets 2")).toBe("cafemarkets");
  });

  it("derives nothing from a name without letters", () => {
    expect(deriveSlug("2026")).toBe("");
  });

  it("cuts a long name to 63 characters", () => {
    expect(deriveSlug("a".repeat(100))).toHaveLength(63);
  });

  it("removes hyphens and punctuation", () => {
    expect(slugCharacters("Desk-Top1")).toBe("desktop");
  });
});

describe("SLUG", () => {
  it.each(["markets", "a", "x".repeat(63)])("accepts %s", (value) => {
    expect(SLUG.test(value)).toBe(true);
  });

  it.each(["", "markets2", "my-portal", "Markets", "my portal", "x".repeat(64)])("rejects %j", (value) => {
    expect(SLUG.test(value)).toBe(false);
  });
});
