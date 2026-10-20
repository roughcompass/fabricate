import { type Experience, type MenuNode, OVERLAY_LABELS, SEVERITY_LABELS, SLOT_LABELS, ZONE_LABELS, ZONES, type ZoneId } from "./document";

/*
 * Pending changes (add-portal-experience-editor, design decision 4): the
 * difference between the saved experience and the working one, as the rows
 * Change history lists. Each row names where the change is, the field, the
 * original value, marked when it's the built-in default, and the new value,
 * and can be reverted on its own. Scalars give one row per field; slots one
 * row per field per slot plus one for their order; messages, menu entries,
 * runtime modules, and installed toolkits one row per entry plus one for an
 * order change. Shared by the editor's client code, so it imports nothing
 * server-only.
 */

export interface ChangeRow {
  /** Identifies the change, and how revertChange undoes it. */
  key: string;
  /** The editor view, such as "Portal Configuration". */
  location: string;
  /** Where in the view, such as "Session Policy". */
  section: string;
  field: string;
  original: string;
  next: string;
  originalIsDefault: boolean;
}

const CONFIG = "Portal Configuration";
const ZONES_VIEW = "Frame Zones";
const OVERLAYS_VIEW = "Frame Overlays";
const TOOLKITS_VIEW = "Capability Toolkit";

/** Labels for scalar fields by path; a path not listed is labeled from its last segment. */
const SCALARS: Record<string, [location: string, section: string, field: string]> = {
  "brand.portalName": [CONFIG, "Brand & identity", "Portal name"],
  "brand.logoLinksHome": [CONFIG, "Brand & identity", "Logo links to the landing path"],
  "favicon.enabled": [CONFIG, "Favicon", "Enabled"],
  "favicon.dataUrl": [CONFIG, "Favicon", "Favicon data URL"],
  "theme.id": [CONFIG, "Design Theme", "Active theme"],
  "theme.version": [CONFIG, "Design Theme", "Theme version"],
  copyright: [CONFIG, "Copyright Information", "Copyright information"],
  "routing.basePath": [CONFIG, "Routing configuration", "Base path"],
  "routing.basePathLocked": [CONFIG, "Routing configuration", "Base path locked"],
  "routing.landingPath": [CONFIG, "Routing configuration", "Default landing path"],
  "routing.mode": [CONFIG, "Routing configuration", "Routing mode"],
  "session.rememberLastRoute": [CONFIG, "Session Policy", "Remember last visited route"],
  "session.logoutRedirect.enabled": [CONFIG, "Session Policy", "Logout redirect enabled"],
  "session.logoutRedirect.url": [CONFIG, "Session Policy", "Logout redirect URL"],
  "crashError.title": [CONFIG, "Crash Error", "Title"],
  "crashError.message": [CONFIG, "Crash Error", "Message"],
  "crashError.action": [CONFIG, "Crash Error", "Action label"],
  "crashError.supportUrl": [CONFIG, "Crash Error", "Support link"],
  "frame.banner.status": [ZONES_VIEW, "Banner Zone", "Banner status"],
  "frame.banner.dismiss": [ZONES_VIEW, "Banner Zone", "Dismiss action"],
  "frame.sidebar.menuType": [ZONES_VIEW, "Sidebar Zone → Main Slot", "Menu type"],
  "toolkits.globalSearch.placeholder": [TOOLKITS_VIEW, "Global Search", "Placeholder"],
  "toolkits.globalSearch.shortcut": [TOOLKITS_VIEW, "Global Search", "Keyboard shortcut"],
  "toolkits.globalSearch.width": [TOOLKITS_VIEW, "Global Search", "Width"],
  "toolkits.notifications.title": [TOOLKITS_VIEW, "Notifications", "Title"],
  "toolkits.notifications.showUnread": [TOOLKITS_VIEW, "Notifications", "Show unread count"],
};

const DIALOG_SECTIONS: Record<string, string> = { inactivity: "Session inactivity alert", duplicate: "Duplicate session alert", systemError: "System error alert" };
const DIALOG_FIELDS: Record<string, string> = { custom: "Custom language", title: "Dialog title", message: "Dialog message", primary: "Primary action label", secondary: "Secondary action label" };
const TOAST_FIELDS: Record<string, string> = { visible: "Visible", title: "Title", message: "Message", autoDismiss: "Auto-dismiss", seconds: "Dismiss after (seconds)" };

function labelOf(path: string): [string, string, string] {
  if (SCALARS[path]) return SCALARS[path];
  const parts = path.split(".");
  if (parts[0] === "sessionLanguage") return [CONFIG, `Default Session Language · ${DIALOG_SECTIONS[parts[1]!] ?? parts[1]}`, DIALOG_FIELDS[parts[2]!] ?? parts[2]!];
  if (parts[0] === "overlays") return [OVERLAYS_VIEW, OVERLAY_LABELS[parts[1] as keyof typeof OVERLAY_LABELS] ?? parts[1]!, TOAST_FIELDS[parts[2]!] ?? parts[2]!];
  if (parts[0] === "frame") {
    const zone = ZONE_LABELS[parts[1] as ZoneId] ?? parts[1]!;
    if (parts[2] === "visible") return [ZONES_VIEW, zone, "Visible"];
    if (parts[2] === "external") return [ZONES_VIEW, zone, "External module"];
  }
  return [CONFIG, parts.slice(0, -1).join(" · "), parts.at(-1)!];
}

/** How a value reads in Change history. */
export function formatValue(value: unknown): string {
  if (value === true) return "On";
  if (value === false) return "Off";
  if (value === null || value === undefined || value === "") return "None";
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && value && "module" in value && "range" in value) return `${(value as { module: string }).module} ${(value as { range: string }).range}`;
  return JSON.stringify(value);
}

type Json = unknown;

function get(target: Json, path: string): Json {
  return path.split(".").reduce<Json>((value, key) => (value && typeof value === "object" ? (value as Record<string, Json>)[key] : undefined), target);
}

/** +target+ with +value+ at +path+, copying only the objects along the path. */
function set<T>(target: T, path: string, value: Json): T {
  const [head, ...rest] = path.split(".");
  const copy = { ...(target as Record<string, Json>) };
  copy[head!] = rest.length ? set(copy[head!], rest.join("."), value) : value;
  return copy as T;
}

const equal = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);

/** Paths whose arrays diff entry by entry, not as scalars. */
const ARRAYS = new Set(["messages", "menu", "runtimeModules", "toolkits.installed", "toolkits.globalSearch.sources", ...ZONES.map((zone) => `frame.${zone}.slots`)]);

/** Every scalar path in +value+, skipping the entry-by-entry arrays. */
function scalarPaths(value: Json, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value as Record<string, Json>).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (ARRAYS.has(path)) return [];
    if (path.endsWith(".external")) return [path];
    return scalarPaths(child, path);
  });
}

const order = (ids: readonly string[], within: Set<string>) => ids.filter((id) => within.has(id));

/** The rows by which +present+ differs from +saved+; +defaults+ marks originals that are the built-in values. */
export function diffExperience(saved: Experience, present: Experience, defaults?: Experience): ChangeRow[] {
  const rows: ChangeRow[] = [];
  const row = (key: string, [location, section, field]: [string, string, string], original: Json, next: Json, defaultPath?: string) =>
    rows.push({ key, location, section, field, original: formatValue(original), next: formatValue(next), originalIsDefault: Boolean(defaults && defaultPath !== undefined && equal(get(defaults, defaultPath), original)) });

  for (const path of scalarPaths(saved)) {
    const [before, after] = [get(saved, path), get(present, path)];
    if (!equal(before, after)) row(`scalar:${path}`, labelOf(path), before, after, path);
  }

  for (const zone of ZONES) {
    const [before, after] = [saved.frame[zone].slots, present.frame[zone].slots];
    for (const slot of before) {
      const next = after.find((entry) => entry.id === slot.id);
      if (!next) continue;
      const section = `${ZONE_LABELS[zone]} → ${SLOT_LABELS[slot.id] ?? slot.id}`;
      if (slot.visible !== next.visible) row(`slot:${zone}:${slot.id}:visible`, [ZONES_VIEW, section, "Visible"], slot.visible, next.visible, `frame.${zone}.slots`);
      if (!equal(slot.external, next.external)) row(`slot:${zone}:${slot.id}:external`, [ZONES_VIEW, section, "External module"], slot.external, next.external);
    }
    const ids = new Set(before.map((slot) => slot.id));
    if (!equal(order(before.map((slot) => slot.id), ids), order(after.map((slot) => slot.id), ids))) {
      row(`order:frame.${zone}.slots`, [ZONES_VIEW, ZONE_LABELS[zone], "Slot order"], before.map((slot) => SLOT_LABELS[slot.id] ?? slot.id).join(", "), after.map((slot) => SLOT_LABELS[slot.id] ?? slot.id).join(", "));
    }
  }

  keyedRows(rows, "messages", saved.messages, present.messages, (message) => message.id, (message) => `${SEVERITY_LABELS[message.severity]}: ${message.title}`, [ZONES_VIEW, "Banner Zone → Message Slot", "System message"]);
  keyedRows(rows, "menu", saved.menu, present.menu, (node) => node.id, (node) => menuSummary(node), [ZONES_VIEW, "Sidebar Zone → Main Slot", "Menu entry"]);
  keyedRows(rows, "runtimeModules", saved.runtimeModules, present.runtimeModules, (module) => module.name, (module) => `${module.name}@${module.version}`, [CONFIG, "Runtime modules", "Runtime module"]);

  for (const toolkit of new Set([...saved.toolkits.installed, ...present.toolkits.installed])) {
    const [before, after] = [saved.toolkits.installed.includes(toolkit), present.toolkits.installed.includes(toolkit)];
    if (before !== after) row(`toolkit:${toolkit}`, [TOOLKITS_VIEW, toolkitName(toolkit), "Installed"], before, after);
  }
  if (!equal(saved.toolkits.globalSearch.sources, present.toolkits.globalSearch.sources)) {
    const summary = (sources: Experience["toolkits"]["globalSearch"]["sources"]) => sources.map((source) => `${source.label}${source.enabled ? "" : " (off)"}`).join(", ");
    row("whole:toolkits.globalSearch.sources", [TOOLKITS_VIEW, "Global Search", "Data sources"], summary(saved.toolkits.globalSearch.sources), summary(present.toolkits.globalSearch.sources));
  }
  return rows;
}

const TOOLKIT_NAMES: Record<string, string> = { "global-search": "Global Search", notifications: "Notifications", "system-messages": "System Messages", "menu-management": "Menu Management", "session-management": "Session Management" };
const toolkitName = (id: string) => TOOLKIT_NAMES[id] ?? id;
const menuSummary = (node: MenuNode) => (node.kind === "group" ? `Group ${node.label}` : `${node.label} ${node.route ?? ""}${node.isDefault ? " (default)" : ""}`.trim());

function keyedRows<T>(rows: ChangeRow[], path: string, before: readonly T[], after: readonly T[], idOf: (entry: T) => string, summary: (entry: T) => string, label: [string, string, string]) {
  const [location, section, field] = label;
  const push = (key: string, original: string, next: string) => rows.push({ key, location, section, field, original, next, originalIsDefault: false });
  for (const entry of after) {
    const earlier = before.find((candidate) => idOf(candidate) === idOf(entry));
    if (!earlier) push(`entry:${path}:${idOf(entry)}`, "None", summary(entry));
    else if (!equal(earlier, entry)) push(`entry:${path}:${idOf(entry)}`, summary(earlier), summary(entry));
  }
  for (const entry of before) if (!after.some((candidate) => idOf(candidate) === idOf(entry))) push(`entry:${path}:${idOf(entry)}`, summary(entry), "None");
  const common = new Set(before.map(idOf).filter((id) => after.some((entry) => idOf(entry) === id)));
  if (!equal(order(before.map(idOf), common), order(after.map(idOf), common))) push(`order:${path}`, "Earlier order", "New order");
}

/** Reorders +present+'s entries so the ones +saved+ also has keep +saved+'s relative order, others staying where they are. */
function restoreOrder<T>(saved: readonly T[], present: readonly T[], idOf: (entry: T) => string): T[] {
  const savedIds = saved.map(idOf);
  const common = present.filter((entry) => savedIds.includes(idOf(entry)));
  const sorted = [...common].sort((a, b) => savedIds.indexOf(idOf(a)) - savedIds.indexOf(idOf(b)));
  let next = 0;
  return present.map((entry) => (savedIds.includes(idOf(entry)) ? sorted[next++]! : entry));
}

const ARRAY_IDS: Record<string, (entry: never) => string> = {
  messages: (entry: { id: string }) => entry.id,
  menu: (entry: { id: string }) => entry.id,
  runtimeModules: (entry: { name: string }) => entry.name,
};

/** +present+ with the change +key+ undone, back to +saved+'s value. */
export function revertChange(saved: Experience, present: Experience, key: string): Experience {
  const [kind, ...rest] = key.split(":");
  const tail = rest.join(":");
  switch (kind) {
    case "scalar":
    case "whole":
      return set(present, tail, get(saved, tail));
    case "slot": {
      const [zone, slot, field] = rest as [ZoneId, string, "visible" | "external"];
      const original = saved.frame[zone].slots.find((entry) => entry.id === slot)!;
      return set(present, `frame.${zone}.slots`, present.frame[zone].slots.map((entry) => (entry.id === slot ? { ...entry, [field]: original[field] } : entry)));
    }
    case "order": {
      if (tail.startsWith("frame.")) {
        const zone = tail.split(".")[1] as ZoneId;
        return set(present, tail, restoreOrder(saved.frame[zone].slots, present.frame[zone].slots, (entry) => entry.id));
      }
      const idOf = ARRAY_IDS[tail] as (entry: unknown) => string;
      return set(present, tail, restoreOrder(get(saved, tail) as unknown[], get(present, tail) as unknown[], idOf));
    }
    case "entry": {
      const [path, ...idParts] = rest;
      const id = idParts.join(":");
      const idOf = ARRAY_IDS[path!] as (entry: unknown) => string;
      const before = get(saved, path!) as unknown[];
      const after = get(present, path!) as unknown[];
      const original = before.find((entry) => idOf(entry) === id);
      if (!original) {
        // Added: drop it, and, in the menu, everything added inside it.
        const dropped = new Set([id]);
        if (path === "menu") for (let grew = true; grew; ) { grew = false; for (const node of after as MenuNode[]) if (node.parentId && dropped.has(node.parentId) && !dropped.has(node.id) && !before.some((entry) => idOf(entry) === node.id)) { dropped.add(node.id); grew = true; } }
        return set(present, path!, after.filter((entry) => !dropped.has(idOf(entry))));
      }
      if (!after.some((entry) => idOf(entry) === id)) {
        // Removed: put it back where it was, after the entries that preceded it.
        const index = before.indexOf(original);
        const precedingIds = before.slice(0, index).map(idOf);
        const insertAt = Math.max(0, ...after.map((entry, position) => (precedingIds.includes(idOf(entry)) ? position + 1 : 0)));
        return set(present, path!, [...after.slice(0, insertAt), original, ...after.slice(insertAt)]);
      }
      return set(present, path!, after.map((entry) => (idOf(entry) === id ? original : entry)));
    }
    case "toolkit": {
      const installed = saved.toolkits.installed.includes(tail);
      const list = present.toolkits.installed.filter((toolkit) => toolkit !== tail);
      return set(present, "toolkits.installed", installed ? [...list, tail] : list);
    }
    default:
      return present;
  }
}
