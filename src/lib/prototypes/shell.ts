import { eq } from "drizzle-orm";
import { IssueCollector } from "@/lib/db/errors";
import type { PrototypesExecutor } from "./db/client";
import { pageShells } from "./db/schema";
import { DEFAULT_SHELL } from "./seed/defaults";
import type { ShellConfig } from "./types";

/** The workspace's current page shell (page-shell spec, "Page versions render with the current shell"). */
export async function workspaceShell(db: PrototypesExecutor, workspaceId: string): Promise<ShellConfig> {
  const [row] = await db.select({ config: pageShells.config }).from(pageShells).where(eq(pageShells.workspaceId, workspaceId));
  return row?.config ?? DEFAULT_SHELL;
}

/** The page shell's bounds (page-shell spec, "The shell's contents are workspace data"). */
export const SHELL_LIMITS = { appName: 60, label: 30, nav: { min: 2, max: 10 }, children: 6, footerText: 200, footerLinks: 5, href: 200 } as const;

/** The Page shell form's fields: navigation and footer links are one per line. */
export interface ShellFormValues {
  appName: string;
  /** One item per line, as "Label: Child, Child". */
  nav: string;
  footerText: string;
  /** One link per line, as "Label: #anchor". */
  footerLinks: string;
}

const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const clean = (value: string) => value.trim().replace(/\s+/g, " ");

/** Splits "Label: rest" at its first colon. */
function labelled(line: string): [label: string, rest: string] {
  const at = line.indexOf(":");
  return at < 0 ? [clean(line), ""] : [clean(line.slice(0, at)), line.slice(at + 1).trim()];
}

export function shellFormValues(shell: ShellConfig): ShellFormValues {
  return {
    appName: shell.appName,
    nav: shell.nav.map((item) => (item.children.length ? `${item.label}: ${item.children.join(", ")}` : item.label)).join("\n"),
    footerText: shell.footerText,
    footerLinks: shell.footerLinks.map((link) => `${link.label}: ${link.href}`).join("\n"),
  };
}

/** Reads and checks the form, or throws a ValidationError naming each field's problem. */
export function parseShell(values: ShellFormValues): ShellConfig {
  const issues = new IssueCollector();
  const { label: LABEL } = SHELL_LIMITS;
  const appName = clean(values.appName);
  if (!appName) issues.add("appName", "Enter the application's name.");
  else if (appName.length > SHELL_LIMITS.appName) issues.add("appName", `Use at most ${SHELL_LIMITS.appName} characters.`);

  const nav = lines(values.nav).map((line) => {
    const [label, rest] = labelled(line);
    return { label, children: rest.split(",").map(clean).filter(Boolean) };
  });
  if (nav.length < SHELL_LIMITS.nav.min || nav.length > SHELL_LIMITS.nav.max) issues.add("nav", `Give ${SHELL_LIMITS.nav.min} to ${SHELL_LIMITS.nav.max} navigation items, one per line.`);
  else if (nav.some((item) => !item.label)) issues.add("nav", "Start every line with the item's name.");
  else if (nav.some((item) => item.label.length > LABEL || item.children.some((child) => child.length > LABEL))) issues.add("nav", `Keep each item and child to ${LABEL} characters.`);
  else if (nav.some((item) => item.children.length > SHELL_LIMITS.children)) issues.add("nav", `Give an item at most ${SHELL_LIMITS.children} children.`);
  else if (new Set(nav.map((item) => item.label.toLowerCase())).size !== nav.length) issues.add("nav", "Give every item a different name.");

  const footerText = clean(values.footerText);
  if (footerText.length > SHELL_LIMITS.footerText) issues.add("footerText", `Use at most ${SHELL_LIMITS.footerText} characters.`);

  const footerLinks = lines(values.footerLinks).map((line) => {
    const [label, href] = labelled(line);
    return { label, href };
  });
  if (footerLinks.length > SHELL_LIMITS.footerLinks) issues.add("footerLinks", `Give at most ${SHELL_LIMITS.footerLinks} links.`);
  else if (footerLinks.some((link) => !link.label || link.label.length > LABEL)) issues.add("footerLinks", `Start every line with the link's text, at most ${LABEL} characters.`);
  // Prototypes render in a frame that makes no network request, so links stay in the page.
  else if (footerLinks.some((link) => !/^#[\w-]+$/.test(link.href) || link.href.length > SHELL_LIMITS.href)) issues.add("footerLinks", "Follow each link's text with a colon and an in-page address, such as Help: #help.");

  issues.throwIfAny();
  return { appName, nav, footerText, footerLinks };
}

/** Saves the workspace's shell; every page version renders with it from its next render. */
export async function saveShell(db: PrototypesExecutor, workspaceId: string, shell: ShellConfig, now = new Date()): Promise<void> {
  await db
    .insert(pageShells)
    .values({ workspaceId, config: shell, updatedAt: now })
    .onConflictDoUpdate({ target: pageShells.workspaceId, set: { config: shell, updatedAt: now } });
}
