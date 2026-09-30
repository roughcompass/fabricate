import { DEFAULT_BUDGETS } from "@repo-facts/contract";
import { type ReaderFactory, readerConformanceCases } from "@repo-facts/contract/testing";
import { afterAll, describe, it } from "vitest";
import { SnapshotFixture } from "../support/snapshot";

/**
 * The repo-facts reader conformance suite. Each case commits its files to a
 * fresh repository, acquires and pins it like a real Assessment target, and
 * requires the SnapshotReader to match the reference reader exactly.
 */
describe("SnapshotReader conforms to the repo-facts SourceReader contract", () => {
  const fixtures: SnapshotFixture[] = [];
  afterAll(() => {
    for (const fixture of fixtures) fixture.cleanup();
  });

  const factory: ReaderFactory = async (files, options) => {
    const fixture = SnapshotFixture.create("conformance");
    fixtures.push(fixture);
    // The reference reader's default budgets, rather than Fabricate's configured ones, when a case sets none.
    return fixture.open(files, options.budgets ?? DEFAULT_BUDGETS, options.protectedDirectories ? { protectedDirectories: options.protectedDirectories } : {});
  };

  for (const test of readerConformanceCases()) it(test.name, () => test.run(factory));
});
