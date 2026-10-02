import { describe, expect, it } from "vitest";
import { CURRENT_VERSION, DOCUMENT_SCHEMAS, readableBy } from "@/lib/documents/schemas";

describe("document versions", () => {
  it("makes Repository Profile version 2, which embeds fact document version 2, current", () => {
    expect(CURRENT_VERSION.repositoryProfile).toBe(2);
    expect(DOCUMENT_SCHEMAS.repositoryProfile.versions).toEqual([1, 2]);
  });

  it("lets a reader of Profile version 1 read version 2, which only adds fields, but not the reverse", () => {
    expect(readableBy("repositoryProfile", 2, [1])).toBe(true);
    expect(readableBy("repositoryProfile", 2, [2])).toBe(true);
    expect(readableBy("repositoryProfile", 1, [2])).toBe(false);
    expect(readableBy("repositoryProfile", 1, [1, 2])).toBe(true);
    expect(readableBy("relationshipMap", 1, [1])).toBe(true);
    expect(readableBy("relationshipMap", 2, [1])).toBe(false);
  });
});
