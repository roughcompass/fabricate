/**
 * Stubs for Next.js request-scoped APIs so Server Actions run in Vitest.
 * Vitest hoists vi.mock, so each test file declares the mocks at top level:
 *
 *   vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);
 *   vi.mock("next/cache", async () => (await import("../support/next")).cacheStub);
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

export const cacheStub = { revalidatePath: () => {}, refresh: () => {} };

export async function redirectOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof Redirect) return error.location;
    throw error;
  }
  throw new Error("expected a redirect");
}
