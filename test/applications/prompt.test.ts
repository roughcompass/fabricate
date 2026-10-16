import { describe, expect, it } from "vitest";
import { routeBuildPrompt } from "@/lib/applications/prompt";

// The Add application prompt bar (make-applications-first-class task 7.1).

const hosts = ["bitbucket.org", "bitbucket.example.com"];

describe("routeBuildPrompt", () => {
  it("opens Create Application with a GitHub or Bitbucket URL filled in and no starter (Pasting a GitHub URL)", () => {
    expect(routeBuildPrompt("https://github.com/acme/payee-hub", hosts)).toEqual({ kind: "redirect", href: "/applications/new/create?repo=https%3A%2F%2Fgithub.com%2Facme%2Fpayee-hub&from=new" });
    expect(routeBuildPrompt("github.com/acme/payee-hub.git", hosts)).toEqual({ kind: "redirect", href: "/applications/new/create?repo=https%3A%2F%2Fgithub.com%2Facme%2Fpayee-hub&from=new" });
    expect(routeBuildPrompt("https://bitbucket.example.com/projects/PAY/repos/payee-hub", hosts)).toMatchObject({ kind: "redirect", href: expect.stringContaining("repo=https%3A%2F%2Fbitbucket.example.com%2Fprojects%2FPAY%2Frepos%2Fpayee-hub") });
    expect(routeBuildPrompt("git@github.com:acme/payee-hub.git", hosts)).toMatchObject({ kind: "redirect", href: expect.stringContaining("repo=git%40github.com%3Aacme%2Fpayee-hub.git") });
  });

  it("keeps the page for any other URL, saying only Bitbucket and GitHub are accepted (Unsupported URL)", () => {
    expect(routeBuildPrompt("https://gitlab.com/acme/payee-hub", hosts)).toEqual({ kind: "error", message: "Only Bitbucket and GitHub repository URLs are accepted", keep: true });
    expect(routeBuildPrompt("https://github.com/acme", hosts)).toMatchObject({ kind: "error", keep: true, message: expect.stringMatching(/URL of a repository/) });
  });

  it("refuses a URL with credentials without keeping it in the field", () => {
    expect(routeBuildPrompt("https://user:ghp_secret@github.com/acme/payee-hub", hosts)).toMatchObject({ kind: "error", keep: false });
  });

  it("opens the full catalog searched for a description (Describing what to build)", () => {
    expect(routeBuildPrompt("dashboard", hosts)).toEqual({ kind: "redirect", href: "/applications/new/templates?q=dashboard" });
    expect(routeBuildPrompt("  payments   approval queue ", hosts)).toEqual({ kind: "redirect", href: "/applications/new/templates?q=payments+approval+queue" });
  });

  it("asks for something when the prompt is empty", () => {
    expect(routeBuildPrompt("   ", hosts)).toMatchObject({ kind: "error", keep: true });
  });
});
