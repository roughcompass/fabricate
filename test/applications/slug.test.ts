import { describe, expect, it } from "vitest";
import { APPLICATION_SLUG, deriveApplicationSlug, slugProblem } from "@/lib/applications/slug";

// Application slugs (make-applications-first-class task 3.3).

describe("deriveApplicationSlug", () => {
  it.each([
    ["Payee Hub 2", "payee-hub-2"],
    ["  Payee   Hub  ", "payee-hub"],
    ["Café Desk — Ledger", "cafe-desk-ledger"],
    ["Ünïcode Ñame", "unicode-name"],
    ["payee_hub.v2", "payee-hub-v2"],
    ["---", ""],
  ])("derives %j as %j (Derived slug)", (name, slug) => {
    expect(deriveApplicationSlug(name)).toBe(slug);
  });

  it("cuts an over-long name to 63 characters, without a trailing hyphen", () => {
    const slug = deriveApplicationSlug(`${"a".repeat(62)} b`);
    expect(slug).toBe("a".repeat(62));
    expect(deriveApplicationSlug("x".repeat(100))).toHaveLength(63);
  });

  it("keeps a leading digit, which the slug rule then refuses", () => {
    expect(deriveApplicationSlug("2 Payee")).toBe("2-payee");
    expect(slugProblem("2-payee")).toBe("Start the slug with a letter");
  });
});

describe("the slug rule", () => {
  it.each(["payees", "payee-hub-2", "a", "a".repeat(63)])("accepts %j", (slug) => {
    expect(APPLICATION_SLUG.test(slug)).toBe(true);
    expect(slugProblem(slug)).toBeNull();
  });

  it.each([
    ["", "Enter a slug"],
    ["a".repeat(64), "Use 63 characters or fewer"],
    ["-payees", "Start the slug with a letter"],
    ["payee--hub", "Use only lowercase letters, digits, and single hyphens"],
    ["payees-", "Use only lowercase letters, digits, and single hyphens"],
    ["Payees", "Start the slug with a letter"],
    ["payee hub", "Use only lowercase letters, digits, and single hyphens"],
  ])("refuses %j: %s", (slug, message) => {
    expect(slugProblem(slug)).toBe(message);
  });
});
