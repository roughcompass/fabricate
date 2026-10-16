import fs from "node:fs";
import path from "node:path";
import type { PrototypeSource } from "@/lib/prototypes/gates";

// Fixture sources are .txt so the repository typecheck doesn't compile them;
// some fail the typecheck on purpose.
const DIR = path.resolve("test/fixtures/prototypes");

export function fixture(name: string): string {
  return fs.readFileSync(path.join(DIR, name), "utf8");
}

/** A realistic, valid prototype: urgent payments in a Salt table, styled only with tokens. */
export function goodSource(): PrototypeSource {
  return { code: fixture("good/Prototype.tsx.txt"), data: fixture("good/data.ts.txt") };
}

/** The good page with a property Salt's Button doesn't have. */
export function hallucinatedPropSource(): PrototypeSource {
  return { code: fixture("hallucinated-prop/Prototype.tsx.txt"), data: fixture("good/data.ts.txt") };
}
