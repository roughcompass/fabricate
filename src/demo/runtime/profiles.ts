import { BUILT_IN_PROFILES, DEFAULT_PROFILE, type Profile } from "@/lib/demo/catalog";
import type { ShareState } from "@/lib/demo/shares";
import { SHARED_PROFILE_ID } from "./view-store";

/**
 * The session profiles a running application offers (template-demo/toolbar
 * spec): a share link's snapshot, the built-in profiles, and the visitor's
 * own. The visitor's own come with the runtime descriptor, so the first render
 * already knows them, and the Session tool keeps this store in step with the
 * workspace as it changes them.
 */

type Listener = () => void;

export interface ProfilesStore {
  subscribe(listener: Listener): () => void;
  /** The visitor's own profiles, oldest first. */
  getProfiles(): readonly Profile[];
  setProfiles(profiles: readonly Profile[]): void;
}

export function createProfilesStore(initial: readonly Profile[]): ProfilesStore {
  const listeners = new Set<Listener>();
  let profiles = initial;
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getProfiles() {
      return profiles;
    },
    setProfiles(next) {
      profiles = next;
      for (const listener of listeners) listener();
    },
  };
}

/** A share link's profile snapshot, read-only and never stored in the recipient's workspace. */
export function sharedProfileOf(share: ShareState | null): Profile | null {
  return share?.profile ? { id: SHARED_PROFILE_ID, ...share.profile, builtIn: false } : null;
}

/** Every profile on offer, in the Session tool's order: the share link's, the built-in profiles, then the visitor's own. */
export function availableProfiles(custom: readonly Profile[], shared: Profile | null): Profile[] {
  return [...(shared ? [shared] : []), ...BUILT_IN_PROFILES, ...custom];
}

/** The profile a view's id names, or Jordan Lee when it no longer exists, as after a deletion. */
export function resolveProfile(id: string, custom: readonly Profile[], shared: Profile | null): Profile {
  return availableProfiles(custom, shared).find((profile) => profile.id === id) ?? DEFAULT_PROFILE;
}
