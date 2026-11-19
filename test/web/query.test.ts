import { describe, expect, it } from "vitest";
import { oneOf, pageNumber, pageQuery, param, searchTerm, withQuery } from "@/lib/web/query";

describe("query strings", () => {
  it("reads one value, the first of several", () => {
    expect(param({ q: "ord" }, "q")).toBe("ord");
    expect(param({ q: ["ord", "bill"] }, "q")).toBe("ord");
    expect(param({}, "q")).toBeUndefined();
  });

  it("reads a value only from a fixed set", () => {
    const tabs = ["gaps", "conforms"] as const;
    expect(oneOf({ conclusion: "gaps" }, "conclusion", tabs)).toBe("gaps");
    expect(oneOf({ conclusion: "<script>" }, "conclusion", tabs)).toBeUndefined();
    expect(oneOf({}, "conclusion", tabs)).toBeUndefined();
  });

  it("clamps a page number to the pages there are, starting from the first", () => {
    expect(pageNumber("2", 45, 20)).toEqual({ page: 2, pages: 3 });
    expect(pageNumber("9", 45, 20)).toEqual({ page: 3, pages: 3 });
    expect(pageNumber("0", 45, 20)).toEqual({ page: 1, pages: 3 });
    expect(pageNumber("two", 45, 20)).toEqual({ page: 1, pages: 3 });
    expect(pageNumber(undefined, 45, 20)).toEqual({ page: 1, pages: 3 });
    expect(pageNumber(2, 0, 20)).toEqual({ page: 1, pages: 1 });
  });

  it("trims a search term and limits its length", () => {
    expect(searchTerm({ q: "  orders  " })).toBe("orders");
    expect(searchTerm({ q: "x".repeat(300) })).toHaveLength(200);
    expect(searchTerm({})).toBe("");
  });

  it("builds an address with the values that are set, and leaves the first page out", () => {
    expect(withQuery("/repositories", { q: "ord", conclusion: null, focus: undefined, empty: "" })).toBe("/repositories?q=ord");
    expect(withQuery("/runs/asm_1/map", { focus: "node_1", page: pageQuery(1) })).toBe("/runs/asm_1/map?focus=node_1");
    expect(withQuery("/runs/asm_1/map", { page: pageQuery(3) }, "relationships")).toBe("/runs/asm_1/map?page=3#relationships");
    expect(withQuery("/assessments")).toBe("/assessments");
  });
});
