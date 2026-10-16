import { describe, expect, it } from "vitest";
import { RepositoryUrlError, detectProvider, parseRepositoryUrl } from "@/lib/applications/repository-url";

/*
 * Repository URLs (make-applications-first-class task 3.2, design decision
 * 5): GitHub and configured Bitbucket hosts, in their HTTPS, SSH, and
 * scp-style forms, and the refusals, none of which repeats what was entered.
 */

const options = { bitbucketHosts: ["bitbucket.org", "bitbucket.example.com"] };
const parse = (input: string, extra: Partial<typeof options & { allowLocal: boolean }> = {}) => parseRepositoryUrl(input, { ...options, ...extra });
const problem = (input: string, extra: Partial<typeof options & { allowLocal: boolean }> = {}) => {
  try {
    parse(input, extra);
  } catch (error) {
    if (error instanceof RepositoryUrlError) return error;
    throw error;
  }
  throw new Error(`${input} was accepted`);
};

describe("parseRepositoryUrl", () => {
  it.each(["https://github.com/acme/payee-hub", "https://github.com/acme/payee-hub.git", "https://GitHub.com/acme/payee-hub/"])("reads the GitHub HTTPS URL %s", (input) => {
    expect(parse(input)).toEqual({ provider: "github", owner: "acme", name: "payee-hub", cloneUrl: "https://github.com/acme/payee-hub.git", webUrl: "https://github.com/acme/payee-hub" });
  });

  it("reads a Bitbucket Server browse address and clone address as the same repository (Bitbucket Server URL)", () => {
    const expected = { provider: "bitbucket", owner: "PAY", name: "payee-hub", cloneUrl: "https://bitbucket.example.com/scm/pay/payee-hub.git", webUrl: "https://bitbucket.example.com/projects/PAY/repos/payee-hub" };
    expect(parse("https://bitbucket.example.com/projects/PAY/repos/payee-hub")).toEqual(expected);
    expect(parse("https://bitbucket.example.com/projects/PAY/repos/payee-hub/browse")).toEqual(expected);
    expect(parse("https://bitbucket.example.com/scm/pay/payee-hub.git")).toEqual(expected);
  });

  it("reads bitbucket.org workspaces", () => {
    expect(parse("https://bitbucket.org/acme/payee-hub.git")).toEqual({ provider: "bitbucket", owner: "acme", name: "payee-hub", cloneUrl: "https://bitbucket.org/acme/payee-hub.git", webUrl: "https://bitbucket.org/acme/payee-hub" });
  });

  it("normalizes scp-style SSH to an ssh:// URL, and keeps SSH for cloning", () => {
    expect(parse("git@github.com:acme/payee-hub.git")).toEqual({ provider: "github", owner: "acme", name: "payee-hub", cloneUrl: "ssh://git@github.com/acme/payee-hub.git", webUrl: "https://github.com/acme/payee-hub" });
    expect(parse("ssh://git@bitbucket.example.com:7999/pay/payee-hub.git")).toMatchObject({ provider: "bitbucket", owner: "PAY", name: "payee-hub", cloneUrl: "ssh://git@bitbucket.example.com:7999/pay/payee-hub.git", webUrl: "https://bitbucket.example.com/projects/PAY/repos/payee-hub" });
  });

  it("refuses GitLab and a Bitbucket host that isn't configured (Unsupported URL)", () => {
    expect(problem("https://gitlab.com/acme/payee-hub").message).toBe("Only Bitbucket and GitHub repository URLs are accepted");
    expect(problem("https://bitbucket.other.example/projects/PAY/repos/payee-hub").problem).toBe("unsupported_host");
  });

  it("refuses a URL with credentials without repeating them (Credentials in the URL)", () => {
    const error = problem("https://user:ghp_secret123@github.com/acme/payee-hub");
    expect(error.problem).toBe("credentials");
    expect(error.message).toMatch(/must not include credentials/);
    expect(error.message).not.toMatch(/ghp_secret123|user:/);
  });

  it.each(["https://github.com/acme", "https://github.com/acme/payee-hub/tree/main", "https://github.com/orgs/acme/repositories", "https://bitbucket.example.com/projects/PAY", "https://bitbucket.example.com/dashboard"])("refuses %s, which isn't a repository", (input) => {
    expect(problem(input).problem).toBe("not_a_repository");
  });

  it("refuses a blank value, and anything that isn't a URL", () => {
    expect(problem("  ").message).toBe("Enter the repository's URL");
    expect(problem("payee hub").problem).toBe("malformed");
    expect(problem("ftp://github.com/acme/payee-hub").problem).toBe("malformed");
  });

  it("accepts a local file:// repository only where the caller allows it", () => {
    expect(problem("file:///srv/fleet/payee-hub").problem).toBe("unsupported_host");
    expect(parse("file:///srv/fleet/payee-hub", { allowLocal: true })).toEqual({ provider: "local", owner: null, name: "payee-hub", cloneUrl: "file:///srv/fleet/payee-hub", webUrl: null });
  });
});

describe("detectProvider", () => {
  it("names the provider once the URL is recognized, and nothing before", () => {
    expect(detectProvider("https://github.com/acme", options)).toBeNull();
    expect(detectProvider("https://github.com/acme/payee-hub", options)).toBe("github");
    expect(detectProvider("https://bitbucket.example.com/projects/PAY/repos/payee-hub", options)).toBe("bitbucket");
  });
});
