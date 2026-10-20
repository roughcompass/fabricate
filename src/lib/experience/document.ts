import { z } from "zod";
import type { Catalogs } from "./catalogs";
import { isRange, isVersion, resolveRange } from "./semver";

/*
 * A Portal's experience (add-portal-experience-editor, design decision 1):
 * one versioned document holding everything the experience editor edits, so
 * undo and redo, the pending-change diff, saving, the preview, and the
 * running portal all work on the same value. The schema checks shape; the
 * rules a person can break, with messages that say how to fix them, are in
 * validateExperience. Imported by the editor's client code, so it imports
 * nothing server-only.
 */

export const ZONES = ["banner", "header", "sidebar", "footer"] as const;
export type ZoneId = (typeof ZONES)[number];

export const ZONE_SLOTS = {
  banner: ["message"],
  header: ["toggle", "brand", "global-search", "actions", "notifications", "feedback", "user-menu"],
  sidebar: ["top", "main", "bottom"],
  footer: ["primary", "secondary", "tertiary"],
} as const satisfies Record<ZoneId, readonly string[]>;
export type SlotId<Z extends ZoneId = ZoneId> = (typeof ZONE_SLOTS)[Z][number];

export const ZONE_LABELS: Record<ZoneId, string> = { banner: "Banner Zone", header: "Header Zone", sidebar: "Sidebar Zone", footer: "Footer Zone" };
export const SLOT_LABELS: Record<string, string> = {
  message: "Message Slot",
  toggle: "Toggle Slot",
  brand: "Brand Slot",
  "global-search": "Global Search Slot",
  actions: "Actions Slot",
  notifications: "Notifications Slot",
  feedback: "Feedback Slot",
  "user-menu": "User Menu Slot",
  top: "Top Slot",
  main: "Main Slot",
  bottom: "Bottom Slot",
  primary: "Primary Slot",
  secondary: "Secondary Slot",
  tertiary: "Tertiary Slot",
};

export const SEVERITIES = ["info", "warning", "error"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABELS: Record<Severity, string> = { info: "Info", warning: "Warning", error: "Error" };
export const BANNER_STATUSES = ["message", ...SEVERITIES] as const;
export const DISMISS_ACTIONS = ["message", "always", "never"] as const;
export const MENU_TYPES = ["left", "flyout"] as const;
export const ROUTING_MODES = ["history", "hash"] as const;
export const SCRIPT_TYPES = ["module", "text/javascript"] as const;
export const CROSS_ORIGINS = ["", "anonymous", "use-credentials"] as const;
export const REFERRER_POLICIES = ["", "no-referrer", "origin", "strict-origin", "strict-origin-when-cross-origin", "same-origin"] as const;
export const FETCH_PRIORITIES = ["auto", "high", "low"] as const;
export const OVERLAYS = ["sessionTimeout", "duplicateSession", "systemError", "successToast", "errorToast"] as const;
export type OverlayId = (typeof OVERLAYS)[number];
export const OVERLAY_LABELS: Record<OverlayId, string> = { sessionTimeout: "Session Timeout Dialog", duplicateSession: "Duplicate Session Dialog", systemError: "System Error Dialog", successToast: "Success Toast", errorToast: "Error Toast" };
export const SESSION_DIALOGS = ["inactivity", "duplicate", "systemError"] as const;
export type SessionDialog = (typeof SESSION_DIALOGS)[number];

const external = z.strictObject({ module: z.string(), range: z.string() }).nullable();
const slot = z.strictObject({ id: z.string(), visible: z.boolean(), external });
const zoneBase = { visible: z.boolean(), external, slots: z.array(slot) };

const dialogCopy = z.strictObject({ custom: z.boolean(), title: z.string(), message: z.string(), primary: z.string(), secondary: z.string() });
const toast = z.strictObject({ visible: z.boolean(), title: z.string(), message: z.string(), autoDismiss: z.boolean(), seconds: z.number().int() });

const message = z.strictObject({
  id: z.string().min(1).max(40),
  title: z.string(),
  description: z.string(),
  severity: z.enum(SEVERITIES),
  dismissible: z.boolean(),
  enabled: z.boolean(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
});

const menuNode = z.strictObject({
  id: z.string().min(1).max(40),
  parentId: z.string().nullable(),
  kind: z.enum(["group", "item"]),
  label: z.string(),
  route: z.string().nullable(),
  application: z.string().nullable(),
  isDefault: z.boolean(),
});

const searchSource = z.strictObject({ id: z.string().min(1).max(40), label: z.string(), enabled: z.boolean() });

const runtimeModule = z.strictObject({
  name: z.string(),
  version: z.string(),
  attributes: z.strictObject({
    type: z.enum(SCRIPT_TYPES),
    async: z.boolean(),
    defer: z.boolean(),
    integrity: z.string(),
    crossorigin: z.enum(CROSS_ORIGINS),
    referrerpolicy: z.enum(REFERRER_POLICIES),
    fetchpriority: z.enum(FETCH_PRIORITIES),
  }),
});

export const experienceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  brand: z.strictObject({ portalName: z.string(), logoLinksHome: z.boolean() }),
  favicon: z.strictObject({ enabled: z.boolean(), dataUrl: z.string() }),
  theme: z.strictObject({ id: z.string(), version: z.string() }),
  copyright: z.string(),
  routing: z.strictObject({ basePath: z.string(), basePathLocked: z.boolean(), landingPath: z.string(), mode: z.enum(ROUTING_MODES) }),
  session: z.strictObject({ rememberLastRoute: z.boolean(), logoutRedirect: z.strictObject({ enabled: z.boolean(), url: z.string() }) }),
  sessionLanguage: z.strictObject({ inactivity: dialogCopy, duplicate: dialogCopy, systemError: dialogCopy }),
  runtimeModules: z.array(runtimeModule),
  crashError: z.strictObject({ title: z.string(), message: z.string(), action: z.string(), supportUrl: z.string() }),
  frame: z.strictObject({
    banner: z.strictObject({ ...zoneBase, status: z.enum(BANNER_STATUSES), dismiss: z.enum(DISMISS_ACTIONS) }),
    header: z.strictObject(zoneBase),
    sidebar: z.strictObject({ ...zoneBase, menuType: z.enum(MENU_TYPES) }),
    footer: z.strictObject(zoneBase),
  }),
  messages: z.array(message),
  overlays: z.strictObject({
    sessionTimeout: z.strictObject({ visible: z.boolean() }),
    duplicateSession: z.strictObject({ visible: z.boolean() }),
    systemError: z.strictObject({ visible: z.boolean() }),
    successToast: toast,
    errorToast: toast,
  }),
  toolkits: z.strictObject({
    installed: z.array(z.string()),
    globalSearch: z.strictObject({ placeholder: z.string(), shortcut: z.string(), width: z.number().int(), sources: z.array(searchSource) }),
    notifications: z.strictObject({ title: z.string(), showUnread: z.boolean() }),
  }),
  menu: z.array(menuNode),
});

export type Experience = z.infer<typeof experienceSchema>;
export type FrameZone = Experience["frame"][ZoneId];
export type FrameSlot = FrameZone["slots"][number];
export type SystemMessage = Experience["messages"][number];
export type MenuNode = Experience["menu"][number];
export type IncludedModule = Experience["runtimeModules"][number];

/** Limits the editor shows and validation enforces. */
export const LIMITS = {
  portalName: 40,
  faviconBytes: 32 * 1024,
  copyright: 200,
  basePath: 60,
  landingPath: 72,
  dialogTitle: 40,
  dialogMessage: 300,
  messageTitle: 80,
  messageDescription: 300,
  menuLabel: 100,
  menuDepth: 5,
  toastSecondsMin: 3,
  toastSecondsMax: 10,
  searchWidthMin: 200,
  searchWidthMax: 640,
} as const;

export const DEFAULT_COPY: Record<SessionDialog, Omit<z.infer<typeof dialogCopy>, "custom">> = {
  inactivity: { title: "Session Expiring", message: "Your session is about to expire due to inactivity. Would you like to extend your session?", primary: "Extend Session", secondary: "Sign Out" },
  duplicate: { title: "Multiple Sessions Detected", message: "You are currently signed in from another location. Continuing here will end the other session.", primary: "Stay Signed In", secondary: "Sign Out" },
  systemError: { title: "System Notification", message: "We are experiencing a temporary service disruption. Please try again shortly.", primary: "OK", secondary: "" },
};

/** The favicon every portal starts with: a J on the brand's dark square. */
export const DEFAULT_FAVICON = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#1b2a3a"/><text x="32" y="45" font-family="Georgia,serif" font-size="40" font-weight="700" fill="#fff" text-anchor="middle">J</text></svg>')}`;

/** Keyboard shortcuts the running portal and the editor already use, which a toolkit shortcut can't take. */
export const RESERVED_SHORTCUTS = ["a", "m", "t", "p", "s", "c", "l", ".", "?", "ctrl+z", "meta+z", "shift+ctrl+z", "shift+meta+z"];

export const DEFAULT_SEARCH_SOURCES = [
  { id: "applications", label: "Applications", enabled: true },
  { id: "accounts", label: "Accounts", enabled: true },
  { id: "payees", label: "Payees", enabled: true },
  { id: "help", label: "Help articles", enabled: false },
];

const slotsOf = (zone: ZoneId): FrameSlot[] => ZONE_SLOTS[zone].map((id) => ({ id, visible: true, external: null }));

export interface ExperienceSubject {
  label: string;
}

/** A fresh experience for +portal+, with +menu+ (its saved menu) and +toolkits+ (the catalog, for which are installed first). */
export function defaultExperience(portal: ExperienceSubject, menu: MenuNode[] = [], toolkits: { id: string; installed: boolean }[] = [], themes: { id: string; shell: "access" | "markets"; default?: boolean }[] = [], year = new Date().getFullYear()): Experience {
  const theme = themes.find((candidate) => candidate.default) ?? themes[0];
  return {
    schemaVersion: 1,
    brand: { portalName: portal.label.slice(0, LIMITS.portalName), logoLinksHome: true },
    favicon: { enabled: true, dataUrl: DEFAULT_FAVICON },
    theme: { id: theme?.id ?? "default", version: "latest" },
    copyright: `© ${year} JPMorgan Chase & Co. All rights reserved.`,
    routing: { basePath: "/", basePathLocked: false, landingPath: "/dashboard", mode: "history" },
    session: { rememberLastRoute: false, logoutRedirect: { enabled: false, url: "" } },
    sessionLanguage: {
      inactivity: { custom: false, ...DEFAULT_COPY.inactivity },
      duplicate: { custom: false, ...DEFAULT_COPY.duplicate },
      systemError: { custom: false, ...DEFAULT_COPY.systemError },
    },
    runtimeModules: [],
    crashError: { title: "Something went wrong", message: "The portal ran into a problem and couldn't show this page. Reload to try again.", action: "Reload page", supportUrl: "" },
    frame: {
      banner: { visible: true, external: null, slots: slotsOf("banner"), status: "message", dismiss: "message" },
      header: { visible: true, external: null, slots: slotsOf("header") },
      sidebar: { visible: true, external: null, slots: slotsOf("sidebar"), menuType: theme?.shell === "markets" ? "flyout" : "left" },
      footer: { visible: true, external: null, slots: slotsOf("footer") },
    },
    messages: [],
    overlays: {
      sessionTimeout: { visible: true },
      duplicateSession: { visible: true },
      systemError: { visible: true },
      successToast: { visible: true, title: "Action completed", message: "Your changes have been saved successfully.", autoDismiss: true, seconds: 5 },
      errorToast: { visible: true, title: "Action failed", message: "Something went wrong. Please try again.", autoDismiss: false, seconds: 5 },
    },
    toolkits: {
      installed: toolkits.filter((toolkit) => toolkit.installed).map((toolkit) => toolkit.id),
      globalSearch: { placeholder: "Search", shortcut: "/", width: 320, sources: DEFAULT_SEARCH_SOURCES.map((source) => ({ ...source })) },
      notifications: { title: "Notifications", showUnread: true },
    },
    menu,
  };
}

/** The document +value+ holds, or null when it isn't a valid experience. */
export function parseExperience(value: unknown): Experience | null {
  const parsed = experienceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Reading the document

/** Which toolkit, if any, a zone's slot needs installed. */
export const SLOT_TOOLKIT: Record<string, string> = { "header.global-search": "global-search", "header.notifications": "notifications" };

export function isInstalled(experience: Experience, toolkit: string): boolean {
  return experience.toolkits.installed.includes(toolkit);
}

/** Whether +zone+'s +slot+ renders: the zone and slot are visible, and any toolkit it needs is installed. */
export function slotShown(experience: Experience, zone: ZoneId, slot: string): boolean {
  const frameZone = experience.frame[zone];
  const entry = frameZone.slots.find((candidate) => candidate.id === slot);
  const toolkit = SLOT_TOOLKIT[`${zone}.${slot}`];
  return frameZone.visible && Boolean(entry?.visible) && (!toolkit || isInstalled(experience, toolkit));
}

export type MessageState = "active" | "scheduled" | "expired" | "disabled";
export const MESSAGE_STATE_LABELS: Record<MessageState, string> = { active: "Active", scheduled: "Scheduled", expired: "Expired", disabled: "Disabled" };

/** A message's state at +now+: off, before its start, after its end, or live. */
export function messageState(message: SystemMessage, now: Date = new Date()): MessageState {
  if (!message.enabled) return "disabled";
  if (message.startsAt && new Date(message.startsAt) > now) return "scheduled";
  if (message.endsAt && new Date(message.endsAt) <= now) return "expired";
  return "active";
}

/** The message the banner shows at +now+: the first active one in list order. */
export function activeMessage(experience: Experience, now: Date = new Date()): SystemMessage | null {
  return experience.messages.find((candidate) => messageState(candidate, now) === "active") ?? null;
}

/** The severity and dismissibility the banner shows +message+ with, after the zone's overrides. */
export function bannerPresentation(experience: Experience, message: SystemMessage): { severity: Severity; dismissible: boolean } {
  const { status, dismiss } = experience.frame.banner;
  return { severity: status === "message" ? message.severity : status, dismissible: dismiss === "message" ? message.dismissible : dismiss === "always" };
}

/** A dialog's copy as shown: custom when turned on, otherwise the default. */
export function dialogCopyOf(experience: Experience, dialog: SessionDialog) {
  const copy = experience.sessionLanguage[dialog];
  return copy.custom ? copy : { ...copy, ...DEFAULT_COPY[dialog] };
}

/** How deep +node+ sits in +menu+: 1 at the top level. */
export function menuDepth(menu: readonly MenuNode[], node: MenuNode): number {
  let depth = 1;
  for (let parent = menu.find((candidate) => candidate.id === node.parentId); parent; parent = menu.find((candidate) => candidate.id === parent!.parentId)) depth += 1;
  return depth;
}

/** The URL a fresh session lands on, as the routing preview shows it. */
export function landingUrl(routing: Experience["routing"], origin = "https://portal.example.com"): string {
  const base = routing.basePath.replace(/\/+$/, "");
  const landing = routing.landingPath.startsWith("/") ? routing.landingPath : `/${routing.landingPath}`;
  return routing.mode === "hash" ? `${origin}${base}/#${landing}` : `${origin}${base}${landing}`;
}

// ---------------------------------------------------------------------------
// Validation

export type EditorView = "frame-zones" | "frame-overlays" | "capabilities" | "configuration" | "messages" | "menu";

export interface ExperienceIssue {
  /** The field's path in the document, such as "favicon.dataUrl". */
  path: string;
  message: string;
  /** Where the editor shows the field. */
  view: EditorView;
  section?: string;
}

export interface ValidationContext {
  catalogs: Catalogs;
  /** The Portal's registered Applications, which its menu items can point at. */
  applications: readonly { publicId: string }[];
}

const PATH = /^\/[A-Za-z0-9\-/]*$/;
const MENU_ROUTE = /^\/[a-z0-9\-/]*$/;
const DATA_URL = /^data:image\/(svg\+xml|png|x-icon|vnd\.microsoft\.icon)(;charset=[A-Za-z0-9-]+)?(;base64)?,/;
const HTTPS_OR_PATH = /^(\/[^\s]*|https:\/\/[^\s/]+[^\s]*)$/;
const INTEGRITY = /^(sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/;
const MODULE_NAME = /^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.-]*$/;
const MESSAGE_ID = /^[A-Za-z0-9_-]+$/;

/** Every problem with +experience+, each at its field: empty when it can be saved. */
export function validateExperience(experience: Experience, context: ValidationContext): ExperienceIssue[] {
  const issues: ExperienceIssue[] = [];
  const add = (path: string, message: string, view: EditorView, section?: string) => issues.push({ path, message, view, section });
  const config = (path: string, message: string, section: string) => add(path, message, "configuration", section);
  const text = (path: string, value: string, label: string, max: number, section: string, required = true) => {
    if (required && !value.trim()) config(path, `Enter ${label}`, section);
    else if (value.length > max) config(path, `Use ${max} characters or fewer`, section);
  };

  // Brand, favicon, theme, copyright.
  text("brand.portalName", experience.brand.portalName, "the portal name", LIMITS.portalName, "brand");
  if (experience.favicon.enabled) {
    if (!DATA_URL.test(experience.favicon.dataUrl)) config("favicon.dataUrl", "Only data URLs of an SVG, PNG, or ICO image are accepted", "favicon");
    else if (experience.favicon.dataUrl.length > LIMITS.faviconBytes * 1.4) config("favicon.dataUrl", "Use an image of 32 KB or less", "favicon");
  }
  const theme = context.catalogs.themes.find((candidate) => candidate.id === experience.theme.id);
  if (!theme) config("theme.id", "Choose a theme from the list", "theme");
  else if (experience.theme.version !== "latest" && !theme.versions.includes(experience.theme.version)) config("theme.version", `Choose a published version of ${theme.name}, or latest`, "theme");
  text("copyright", experience.copyright, "the copyright text", LIMITS.copyright, "copyright");

  // Routing and session.
  const { routing, session } = experience;
  if (!PATH.test(routing.basePath)) config("routing.basePath", "Start with / and use only letters, digits, hyphens, and slashes", "routing");
  else if (routing.basePath.length > LIMITS.basePath) config("routing.basePath", `Use ${LIMITS.basePath} characters or fewer`, "routing");
  if (!PATH.test(routing.landingPath)) config("routing.landingPath", "Start with / and use only letters, digits, hyphens, and slashes", "routing");
  else if (routing.landingPath.length > LIMITS.landingPath) config("routing.landingPath", `Use ${LIMITS.landingPath} characters or fewer`, "routing");
  if (session.logoutRedirect.enabled && !HTTPS_OR_PATH.test(session.logoutRedirect.url.trim())) config("session.logoutRedirect.url", "Enter a path that starts with / or an https URL", "session");

  // Session language.
  for (const dialog of SESSION_DIALOGS) {
    const copy = experience.sessionLanguage[dialog];
    if (!copy.custom) continue;
    const base = `sessionLanguage.${dialog}`;
    text(`${base}.title`, copy.title, "a dialog title", LIMITS.dialogTitle, "session-language");
    text(`${base}.message`, copy.message, "a dialog message", LIMITS.dialogMessage, "session-language");
    text(`${base}.primary`, copy.primary, "an action label", LIMITS.dialogTitle, "session-language");
    if (dialog !== "systemError") text(`${base}.secondary`, copy.secondary, "an action label", LIMITS.dialogTitle, "session-language");
  }

  // Runtime modules.
  const seen = new Set<string>();
  experience.runtimeModules.forEach((included, index) => {
    const path = `runtimeModules.${index}`;
    const registered = context.catalogs.modules.find((candidate) => candidate.name === included.name);
    if (!registered) config(`${path}.name`, `${included.name} isn't in the module catalog`, "runtime-modules");
    else if (included.version !== "latest" && !registered.versions.includes(included.version)) config(`${path}.version`, `Choose a published version of ${included.name}, or latest`, "runtime-modules");
    if (seen.has(included.name)) config(`${path}.name`, `${included.name} is included twice`, "runtime-modules");
    seen.add(included.name);
    if (included.attributes.integrity && !INTEGRITY.test(included.attributes.integrity.trim())) config(`${path}.attributes.integrity`, "Enter a sha256, sha384, or sha512 hash, such as sha384-…", "runtime-modules");
  });

  // Crash error.
  text("crashError.title", experience.crashError.title, "a title", LIMITS.dialogTitle, "crash-error");
  text("crashError.message", experience.crashError.message, "a message", LIMITS.dialogMessage, "crash-error");
  text("crashError.action", experience.crashError.action, "an action label", LIMITS.dialogTitle, "crash-error");
  if (experience.crashError.supportUrl.trim() && !HTTPS_OR_PATH.test(experience.crashError.supportUrl.trim())) config("crashError.supportUrl", "Enter a path that starts with / or an https URL", "crash-error");

  // Frame: slots fixed, external modules resolvable.
  for (const zone of ZONES) {
    const frameZone = experience.frame[zone];
    const ids = frameZone.slots.map((entry) => entry.id).sort();
    if (ids.join() !== [...ZONE_SLOTS[zone]].sort().join()) add(`frame.${zone}.slots`, `${ZONE_LABELS[zone]} must keep its slots`, "frame-zones");
    const checkExternal = (path: string, value: { module: string; range: string } | null) => {
      if (!value) return;
      const registered = context.catalogs.modules.find((candidate) => candidate.name === value.module.trim());
      if (!MODULE_NAME.test(value.module.trim())) add(`${path}.module`, "Enter a module name such as @organization/name", "frame-zones");
      else if (!registered) add(`${path}.module`, `${value.module} isn't a registered module`, "frame-zones");
      if (!isRange(value.range)) add(`${path}.range`, "Enter a semver range, such as ^2.0.0", "frame-zones");
      else if (registered && !resolveRange(registered.versions, value.range)) add(`${path}.range`, `No published version of ${registered.name} matches ${value.range}`, "frame-zones");
    };
    checkExternal(`frame.${zone}.external`, frameZone.external);
    frameZone.slots.forEach((entry, index) => checkExternal(`frame.${zone}.slots.${index}.external`, entry.external));
  }

  // Messages.
  const messageIds = new Set<string>();
  experience.messages.forEach((entry, index) => {
    const path = `messages.${index}`;
    if (!MESSAGE_ID.test(entry.id) || messageIds.has(entry.id)) add(`${path}.id`, "Each message needs its own id", "messages");
    messageIds.add(entry.id);
    if (!entry.title.trim()) add(`${path}.title`, "Enter a title", "messages");
    else if (entry.title.length > LIMITS.messageTitle) add(`${path}.title`, `Use ${LIMITS.messageTitle} characters or fewer`, "messages");
    if (entry.description.length > LIMITS.messageDescription) add(`${path}.description`, `Use ${LIMITS.messageDescription} characters or fewer`, "messages");
    const starts = entry.startsAt ? new Date(entry.startsAt) : null;
    const ends = entry.endsAt ? new Date(entry.endsAt) : null;
    if (starts && Number.isNaN(starts.getTime())) add(`${path}.startsAt`, "Enter a start date and time", "messages");
    if (ends && Number.isNaN(ends.getTime())) add(`${path}.endsAt`, "Enter an end date and time", "messages");
    if (starts && ends && ends <= starts) add(`${path}.endsAt`, "End after the start", "messages");
  });

  // Overlays.
  for (const name of ["successToast", "errorToast"] as const) {
    const entry = experience.overlays[name];
    if (!entry.title.trim()) add(`overlays.${name}.title`, "Enter a title", "frame-overlays");
    if (entry.title.length > LIMITS.dialogTitle) add(`overlays.${name}.title`, `Use ${LIMITS.dialogTitle} characters or fewer`, "frame-overlays");
    if (entry.message.length > LIMITS.dialogMessage) add(`overlays.${name}.message`, `Use ${LIMITS.dialogMessage} characters or fewer`, "frame-overlays");
    if (entry.autoDismiss && (entry.seconds < LIMITS.toastSecondsMin || entry.seconds > LIMITS.toastSecondsMax)) add(`overlays.${name}.seconds`, `Dismiss after ${LIMITS.toastSecondsMin} to ${LIMITS.toastSecondsMax} seconds`, "frame-overlays");
  }

  // Toolkits.
  const known = new Set(context.catalogs.toolkits.map((toolkit) => toolkit.id));
  experience.toolkits.installed.forEach((toolkit, index) => {
    if (!known.has(toolkit)) add(`toolkits.installed.${index}`, `${toolkit} isn't a toolkit in the catalog`, "capabilities");
  });
  if (isInstalled(experience, "global-search")) {
    const search = experience.toolkits.globalSearch;
    const shortcut = search.shortcut.trim().toLowerCase();
    if (!search.placeholder.trim()) add("toolkits.globalSearch.placeholder", "Enter the placeholder text", "capabilities");
    if (!shortcut) add("toolkits.globalSearch.shortcut", "Enter a keyboard shortcut, such as /", "capabilities");
    else if (RESERVED_SHORTCUTS.includes(shortcut)) add("toolkits.globalSearch.shortcut", `${search.shortcut} is taken by another shortcut. Choose another`, "capabilities");
    if (search.width < LIMITS.searchWidthMin || search.width > LIMITS.searchWidthMax) add("toolkits.globalSearch.width", `Use a width from ${LIMITS.searchWidthMin} to ${LIMITS.searchWidthMax} pixels`, "capabilities");
    if (!search.sources.some((source) => source.enabled)) add("toolkits.globalSearch.sources", "Turn on at least one data source", "capabilities");
  }
  if (isInstalled(experience, "notifications") && !experience.toolkits.notifications.title.trim()) add("toolkits.notifications.title", "Enter a title", "capabilities");

  // Menu.
  const applications = new Set(context.applications.map((application) => application.publicId));
  const routes = new Map<string, string>();
  const nodeIds = new Set(experience.menu.map((node) => node.id));
  let defaults = 0;
  experience.menu.forEach((node, index) => {
    const path = `menu.${index}`;
    const label = node.label.trim();
    if (!label) add(`${path}.label`, "Enter a label", "menu");
    else if (label.length > LIMITS.menuLabel) add(`${path}.label`, `Use ${LIMITS.menuLabel} characters or fewer`, "menu");
    if (node.parentId !== null) {
      const parent = experience.menu.find((candidate) => candidate.id === node.parentId);
      if (!nodeIds.has(node.parentId) || parent?.kind !== "group") add(`${path}.parentId`, "Choose a group", "menu");
    }
    if (menuDepth(experience.menu, node) > LIMITS.menuDepth) add(`${path}.parentId`, `Menus nest at most ${LIMITS.menuDepth} levels deep`, "menu");
    if (node.kind === "group") {
      if (node.route !== null || node.application !== null || node.isDefault) add(`${path}.kind`, "A group has no route, Application, or default", "menu");
      return;
    }
    const route = node.route?.trim() ?? "";
    if (!route) add(`${path}.route`, "Enter a route, such as /payees", "menu");
    else if (!MENU_ROUTE.test(route)) add(`${path}.route`, "Enter a route that starts with / and uses only lowercase letters, digits, hyphens, and slashes", "menu");
    else if (routes.has(route)) add(`${path}.route`, `${route} is already used by ${routes.get(route)}`, "menu");
    else routes.set(route, label);
    if (!node.application || !applications.has(node.application)) add(`${path}.application`, "Choose an Application in this Portal", "menu");
    if (node.isDefault) defaults += 1;
  });
  if (defaults > 1) add("menu", "Only one menu item can be the default route", "menu");

  return issues;
}

/** Whether every version string in +experience+ is well formed; a guard for documents read back from storage. */
export function versionsWellFormed(experience: Experience): boolean {
  return experience.runtimeModules.every((included) => included.version === "latest" || isVersion(included.version)) && (experience.theme.version === "latest" || isVersion(experience.theme.version));
}
