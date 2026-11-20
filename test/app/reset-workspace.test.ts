import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResetWorkspaceSection, resetWorkspaceAction, workspaceOutcome } from "@/app/(operator)/applications/reset-workspace";
import { getConfig, setConfig, withOverrides } from "@/lib/config";
import { WORKSPACE_COOKIE, newWorkspaceKey } from "@/lib/workspaces/workspace-key";
import { createShare, findShare } from "@/lib/workspaces/shares";
import { ensureWorkspace, findWorkspace, setDisplayName, setHints } from "@/lib/workspaces/workspaces";
import { redirectOf, useAppDb } from "../support/next";
import { commitOf, viewedApplicationIn } from "../support/views";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined) }) }));
vi.mock("next/navigation", async () => ({ ...(await import("../support/next")).navigationStub, usePathname: () => "/applications" }));

/*
 * Reset workspace, the section the Applications page ends with
 * (template-demo/demo-mode spec, "Visitors can reset their workspace's
 * comments and share links"; add-applications, task 8.7).
 */
describe("Reset workspace", () => {
  const app = useAppDb();
  const original = getConfig();
  beforeEach(() => {
    setConfig(withOverrides(original, { previews: { enabled: true } }));
    cookieJar.clear();
  });
  afterEach(() => setConfig(original));

  it("is a section of its own, saying what goes and what stays, whose trigger submits the reset before JavaScript runs", () => {
    const html = renderToStaticMarkup(createElement(ResetWorkspaceSection));
    expect(html).toMatch(/<h2 [^>]*>Reset workspace<\/h2>/);
    expect(html).toContain("Removes your comments and share links, forgets your display name, and shows the guided hints again. Applications and other visitors&#x27; work aren&#x27;t affected.");
    expect(html).toMatch(/<button type="submit"[^>]*>.*Reset workspace<\/button>/);
  });

  it("clears the visitor's comments, share links, display name, and hints, and returns to Applications with a notice (Reset between presentations)", async () => {
    const key = newWorkspaceKey();
    const workspace = ensureWorkspace(app.db, key);
    setDisplayName(app.db, workspace.id, "Sam");
    setHints(app.db, workspace.id, { off: true });
    const token = createShare(app.db, viewedApplicationIn(app.db).id, workspace.id, { commit: commitOf("a"), route: "/accounts" });
    cookieJar.set(WORKSPACE_COOKIE, key);

    expect(await redirectOf(resetWorkspaceAction())).toBe("/applications?notice=workspace-reset");
    expect(findShare(app.db, token)).toBeNull();
    expect(findWorkspace(app.db, key)).toMatchObject({ displayName: null, hints: {} });
    expect(workspaceOutcome("workspace-reset")).toMatchObject({ tone: "success", title: "Your workspace was reset." });
    expect(workspaceOutcome("reset")).toBeUndefined();
  });

  it("is not found while previews are off", async () => {
    setConfig(withOverrides(original, { previews: { enabled: false } }));
    expect(await redirectOf(resetWorkspaceAction())).toBe("not-found");
  });
});
