import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { type Db, setDb } from "@/lib/db/client";
import { createTestDb } from "./db";

/**
 * Stubs for Next.js request-scoped APIs so Server Actions run in Vitest.
 * Vitest hoists vi.mock, so each test file declares the mock at top level:
 *
 *   vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);
 */

/** Thrown by the stubbed redirect() so tests can assert where an action goes. */
export class Redirect extends Error {
  constructor(readonly location: string) {
    super(`redirect to ${location}`);
  }
}

export const navigationStub = {
  redirect: (location: string): never => {
    throw new Redirect(location);
  },
  notFound: (): never => {
    throw new Redirect("not-found");
  },
};

export async function redirectOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof Redirect) return error.location;
    throw error;
  }
  throw new Error("expected a redirect");
}

/** Registers hooks that give each test, or with `once` the whole suite, a fresh database as the app's, which Server Actions and pages read. */
export function useAppDb(options: { once?: boolean } = {}): { db: Db } {
  const app = {} as { db: Db };
  (options.once ? beforeAll : beforeEach)(() => {
    app.db = createTestDb();
    setDb(app.db);
  });
  (options.once ? afterAll : afterEach)(() => setDb(undefined));
  return app;
}

/** A submitted form: each field once, or once per item of a list. */
export function formData(fields: Readonly<Record<string, string | number | readonly (string | number)[]>>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const item of Array.isArray(value) ? value : [value]) data.append(name, String(item));
  return data;
}
