import { cookies } from "next/headers";

/** The cookie that remembers the name a person acts under in Web Onboarding. It identifies no one and isn't a credential. */
export const ACTOR_COOKIE = "fabricate-actor";

export async function rememberedActor(): Promise<string> {
  return (await cookies()).get(ACTOR_COOKIE)?.value ?? "";
}

/**
 * Remembers the stated name for the next action; only Server Actions can set
 * it. Its path is the whole app, since the Create Portal dialog opens on any
 * page (add-portal-switcher design decision 9). One set before under
 * /onboarding still reads there until it's replaced or expires.
 */
export async function rememberActor(name: string): Promise<void> {
  const value = name.trim().slice(0, 200);
  if (value) (await cookies()).set(ACTOR_COOKIE, value, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
}
