import { describe, expect, it } from "vitest";
import { failureText, redact, redactKnown, redactSecrets } from "@/lib/git/redact";
import { PLANTED } from "../support/credentials";

/*
 * Redaction (add-applications: closing the gap the walkthrough's failure
 * detail found): every credential form npm, Yarn, Git, and HTTP clients
 * print is replaced wherever a diagnostic, a failure reason, or a build log
 * is shown, and ordinary prose is left alone.
 */

describe("redaction", () => {
  it.each(PLANTED.map((planted) => [planted.form, planted.line, planted.secret]))("removes %s", (_form, line, secret) => {
    const redacted = redactSecrets(line);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain("[REDACTED]");
    expect(redact(line)).toBe(redacted);
  });

  it("keeps what a credential belongs to, so a reader knows what was removed", () => {
    expect(redactSecrets("//registry.example.com/:_authToken=abc123")).toBe("//registry.example.com/:_authToken=[REDACTED]");
    expect(redactSecrets('npmAuthToken: "abc123"')).toBe('npmAuthToken: "[REDACTED]"');
    expect(redactSecrets("Authorization: Bearer abc123def")).toBe("Authorization: [REDACTED]");
    expect(redactSecrets("https://deploy:abc123@git.example.com/acme/lib.git")).toBe("https://[REDACTED]@git.example.com/acme/lib.git");
    expect(redactSecrets("NPM_TOKEN=abc123 npm ci")).toBe("NPM_TOKEN=[REDACTED] npm ci");
  });

  it("leaves prose and build output without credentials as it was", () => {
    for (const text of ["Basic usage: run the build", "Bearer of good news", "tokens: 5, passwords: none", "error TS2304: Cannot find name 'password'.", "vite v5.4.21 building for production...", "https://registry.npmjs.org/react/-/react-18.3.1.tgz"]) {
      expect(redactSecrets(text)).toBe(text);
    }
  });

  it("removes a secret a command was handed wherever it appears, in any shape, and then what looks like a credential", () => {
    const secret = "plain7Q2mZx9Kw4Vb8";
    expect(redactSecrets(`rejected ${secret}`)).toBe(`rejected ${secret}`);
    expect(redactKnown(`rejected ${secret}; again:${secret}! token=abc123`, [secret])).toBe("rejected [REDACTED]; again:[REDACTED]! token=[REDACTED]");
    expect(redactKnown(`${"x".repeat(2_100)}${secret}`, [secret])).toHaveLength(2_001);
    expect(redactKnown("nothing to remove", [""])).toBe("nothing to remove");
  });

  it("keeps a log's whole length, while a reason is cut to its limit", () => {
    const long = `${"x".repeat(5_000)} _authToken=abc123`;
    expect(redactSecrets(long)).toHaveLength(5_000 + " _authToken=[REDACTED]".length);
    expect(redact(long)).toHaveLength(2_001);
    expect(failureText(new Error("token=abc123"))).toBe("token=[REDACTED]");
  });
});
