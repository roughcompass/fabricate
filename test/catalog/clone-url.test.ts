import { describe, expect, it } from "vitest";
import { CloneUrl, type CloneUrlErrorCode, InvalidCloneUrl } from "@/lib/catalog/clone-url";

const codeOf = (input: string): CloneUrlErrorCode | null => {
  try {
    CloneUrl.parse(input);
    return null;
  } catch (error) {
    if (error instanceof InvalidCloneUrl) return error.code;
    throw error;
  }
};

describe("clone URLs", () => {
  it.each([
    ["https://git.example.com/acme/orders.git", "https", "https://git.example.com/acme/orders.git", "https://git.example.com/acme/orders"],
    ["ssh://git@git.example.com/acme/orders.git", "ssh", "ssh://git@git.example.com/acme/orders.git", "ssh://git.example.com/acme/orders"],
    ["ssh://git.example.com:2222/acme/orders", "ssh", "ssh://git.example.com:2222/acme/orders", "ssh://git.example.com:2222/acme/orders"],
    ["file:///srv/fleet/orders", "file", "file:///srv/fleet/orders", "file:///srv/fleet/orders"],
    ["file://localhost/srv/fleet/orders.git", "file", "file:///srv/fleet/orders.git", "file:///srv/fleet/orders.git"],
    ["https://[2001:db8::1]/acme/x", "https", "https://[2001:db8::1]/acme/x", "https://[2001:db8::1]/acme/x"],
    ["https://git.example.com/acme/with%20space", "https", "https://git.example.com/acme/with%20space", "https://git.example.com/acme/with space"],
  ])("accepts %s", (input, scheme, stored, canonical) => {
    const url = CloneUrl.parse(input);

    expect(url.scheme).toBe(scheme);
    expect(url.toString()).toBe(stored);
    expect(url.canonical).toBe(canonical);
    expect(CloneUrl.parse(url.toString()).canonical).toBe(canonical);
  });

  it.each([
    ["host case, default port, trailing slash, and .git", ["https://GIT.example.com/acme/orders.git", "https://git.example.com:443/acme/orders/", "https://git.example.com/acme/orders"]],
    ["the SSH user and default port", ["ssh://git@git.example.com:22/acme/orders.git", "ssh://deploy@git.example.com/acme/orders", "ssh://git.example.com/acme/orders/"]],
    ["localhost, duplicate slashes, and a trailing slash on file URLs", ["file:///srv//fleet/orders/", "file://localhost/srv/fleet/orders", "file:///srv/fleet/orders"]],
    ["percent-encoded and literal unreserved characters", ["https://git.example.com/acme/%6Frders", "https://git.example.com/acme/orders"]],
  ])("treats forms that differ only by %s as the same source", (_label, forms) => {
    const canonicals = new Set(forms.map((form) => CloneUrl.parse(form).canonical));
    expect(canonicals.size).toBe(1);
  });

  it("keeps file:// paths distinct from their .git sibling and remote schemes distinct from each other", () => {
    expect(CloneUrl.parse("file:///srv/orders").canonical).not.toBe(CloneUrl.parse("file:///srv/orders.git").canonical);
    expect(CloneUrl.parse("https://git.example.com/a").canonical).not.toBe(CloneUrl.parse("ssh://git.example.com/a").canonical);
    expect(CloneUrl.parse("https://git.example.com/Acme/A").canonical).not.toBe(CloneUrl.parse("https://git.example.com/acme/a").canonical);
  });

  it.each<[string, CloneUrlErrorCode]>([
    ["", "blank"],
    ["   ", "blank"],
    ["ext::sh -c touch% /tmp/pwned", "malformed"],
    ["ext::sh%20-c%20id", "transport_command"],
    ["fd::17/repo", "transport_command"],
    ["transport+evil::whatever", "transport_command"],
    ["git@github.com:acme/orders.git", "scp_shorthand"],
    ["github.com:acme/orders", "scp_shorthand"],
    ["/srv/fleet/orders", "local_path"],
    ["./orders", "local_path"],
    ["~/orders", "local_path"],
    ["orders", "unsupported_scheme"],
    ["http://git.example.com/acme/orders", "unsupported_scheme"],
    ["git://git.example.com/acme/orders", "unsupported_scheme"],
    ["ftp://git.example.com/acme/orders", "unsupported_scheme"],
    ["ssh+git://git.example.com/acme/orders", "unsupported_scheme"],
    ["https://user:hunter2@git.example.com/acme/orders", "embedded_credentials"],
    ["https://ghp_abcdefghijklmnop1234@git.example.com/acme/orders", "embedded_credentials"],
    ["https://oauth2@git.example.com/acme/orders", "embedded_credentials"],
    ["ssh://git:hunter2@git.example.com/acme/orders", "embedded_credentials"],
    ["ssh://-oProxyCommand=touch%20pwned/acme/orders", "option_injection"],
    ["ssh://git@-oProxyCommand=x/acme/orders", "option_injection"],
    ["ssh://-git@git.example.com/acme/orders", "malformed"],
    ["https://git.example.com/-upload-pack=touch/x", "option_injection"],
    ["https://git.example.com/acme/../secrets", "path_traversal"],
    ["https://git.example.com/acme/%2e%2e/secrets", "path_traversal"],
    ["file:///srv/fleet/./orders", "path_traversal"],
    ["https://git.example.com/acme%2Forders", "malformed"],
    ["https://git.example.com/acme/orders?ref=main", "query_or_fragment"],
    ["https://git.example.com/acme/orders#main", "query_or_fragment"],
    ["file://otherhost/srv/orders", "remote_file_host"],
    ["file://user@localhost/srv/orders", "malformed"],
    ["https://git.example.com:99999/acme/orders", "malformed"],
    ["https://git.example.com:/acme/orders", "malformed"],
    ["https://gït.example.com/acme/orders", "malformed"],
    ["https://git_example.com/acme/orders", "malformed"],
    ["https://git.example.com", "malformed"],
    ["https://git.example.com/", "malformed"],
    ["https://git.example.com/acme/%ZZ", "malformed"],
    ["https://git.example.com/acme/%00", "malformed"],
    ["https://git.example.com/acme/%ED%A0%80", "malformed"],
    ["https://git.example.com/acme/orders\u0000", "malformed"],
    ["https://git.example.com/acme orders", "malformed"],
  ])("rejects %j as %s", (input, code) => {
    expect(codeOf(input)).toBe(code);
  });

  it("names the rejected transport and never echoes a credential", () => {
    expect(() => CloneUrl.parse("ext::sh%20-c%20id")).toThrow("The ext:: transport can run arbitrary commands and is not supported");
    expect(() => CloneUrl.parse("http://git.example.com/a")).toThrow("The http:// transport is not supported");

    try {
      CloneUrl.parse("https://user:hunter2@git.example.com/acme/orders");
    } catch (error) {
      expect((error as Error).message).not.toContain("hunter2");
    }
    expect(CloneUrl.redact("https://user:hunter2@git.example.com/acme/orders?token=x")).toBe("https://[REDACTED]@git.example.com/acme/orders");
  });

  it("builds a file:// URL for a local path, escaping characters Git would misread", () => {
    const url = CloneUrl.forLocalPath("/srv/fleet/team repo/#1");

    expect(url.toString()).toBe("file:///srv/fleet/team%20repo/%231");
    expect(url.localPath).toBe("/srv/fleet/team repo/#1");
  });
});
