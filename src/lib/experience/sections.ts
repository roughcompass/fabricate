import type { Experience } from "./document";

/** The Portal Configuration sections, in order, under their group captions (portal-configuration spec). */
export const CONFIGURATION_SECTIONS: { id: string; name: string; description: string; group: string | null; reset: (keyof Experience)[] }[] = [
  { id: "brand", name: "Brand & identity", description: "The J.P. Morgan logo, plus the portal name rendered beside it in the header.", group: null, reset: ["brand"] },
  { id: "favicon", name: "Favicon", description: "Browser tab, bookmark, and history icon. Single asset, rendered at 16/32/64 px.", group: null, reset: ["favicon"] },
  { id: "theme", name: "Design Theme", description: "One theme pack from its owner, pinned to a version or tracking latest.", group: null, reset: ["theme"] },
  { id: "copyright", name: "Copyright Information", description: "Legal footer copy rendered by the Experience Frame's Footer Zone, Primary Slot.", group: "Policies", reset: ["copyright"] },
  { id: "routing", name: "Routing configuration", description: "Base path mount, default landing route, routing mode, and live preview.", group: "Routing & sessions", reset: ["routing"] },
  { id: "session-language", name: "Default Session Language", description: "Default-language copy for the session dialogs: title, message, and actions.", group: "Routing & sessions", reset: ["sessionLanguage"] },
  { id: "session", name: "Session Policy", description: "How the portal remembers user state across visits, such as resuming the last route.", group: "Routing & sessions", reset: ["session"] },
  { id: "runtime-modules", name: "Runtime modules", description: "Federated modules the host includes in the runtime bootstrap, with script attributes.", group: "Runtime", reset: ["runtimeModules"] },
  { id: "crash-error", name: "Crash Error", description: "What the host renders when its error boundary trips. Operator-authored copy.", group: "Runtime", reset: ["crashError"] },
];
