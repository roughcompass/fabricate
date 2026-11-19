import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { preferenceCookie, preferenceCookieRenames } from "@/lib/web/preference-cookies";
import { SIDEBAR_HIDDEN_COOKIE, SIDEBAR_WIDTH_COOKIE } from "@/lib/web/sidebar";
import { THEME_COOKIE } from "@/lib/web/theme";
import { proxy } from "@/proxy";

const jar = (cookies: Record<string, string>) => ({ get: (name: string) => (name in cookies ? { value: cookies[name]! } : undefined) });
const request = (path: string, cookie: string) => new NextRequest(`http://localhost:3000${path}`, { headers: { cookie } });

// Preference cookies are read under their old and new names, and written under the new ones (design.md, decision 9).
describe("preference cookies", () => {
  it("use the new names", () => {
    expect([THEME_COOKIE, SIDEBAR_HIDDEN_COOKIE, SIDEBAR_WIDTH_COOKIE]).toEqual(["frontend-registry-theme", "frontend-registry-sidebar", "frontend-registry-sidebar-width"]);
  });

  it("honor a cookie under its old name, and prefer the new one", () => {
    expect(preferenceCookie(jar({ "fabricate-theme": "dark" }), THEME_COOKIE)).toBe("dark");
    expect(preferenceCookie(jar({ "fabricate-theme": "dark", "frontend-registry-theme": "light" }), THEME_COOKIE)).toBe("light");
    expect(preferenceCookie(jar({}), THEME_COOKIE)).toBeUndefined();
  });

  it("plan to move each old cookie to its new name, keeping its attributes", () => {
    expect(preferenceCookieRenames(jar({ "fabricate-theme": "dark", "fabricate-sidebar-width": "320", "frontend-registry-sidebar": "hidden", "fabricate-sidebar": "shown" }))).toEqual({
      set: [
        { name: "frontend-registry-theme", value: "dark", path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true },
        { name: "frontend-registry-sidebar-width", value: "320", path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" },
      ],
      remove: ["fabricate-theme", "fabricate-sidebar", "fabricate-sidebar-width"],
    });
    expect(preferenceCookieRenames(jar({ "frontend-registry-theme": "dark" }))).toEqual({ set: [], remove: [] });
  });

  it("are rewritten by the proxy: an old theme cookie is honored on this request and stored under its new name", () => {
    const response = proxy(request("/repositories", "fabricate-theme=dark"));
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.cookies.get("frontend-registry-theme")?.value).toBe("dark");
    expect(setCookie).toMatch(/frontend-registry-theme=dark; Path=\/; Expires=[^;]+; Max-Age=31536000; HttpOnly; SameSite=lax/i);
    expect(setCookie).toMatch(/fabricate-theme=; Path=\/; Expires=Thu, 01 Jan 1970/i);
    expect(response.headers.get("x-middleware-request-cookie")).toBe("frontend-registry-theme=dark");
  });

  it("leave requests without old cookies alone", () => {
    expect(proxy(request("/repositories", "frontend-registry-theme=dark")).headers.get("set-cookie")).toBeNull();
  });
});
