import { describe, expect, it } from "vitest";
import { repositoryNameFromUrl } from "@/lib/repositories/repository-name";

describe("a Repository's default name from its clone URL", () => {
  it.each([
    ["https://github.com/vickykatoch/helios.git", "vickykatoch-helios"],
    ["https://github.com/vickykatoch/helios", "vickykatoch-helios"],
    ["https://github.com/vickykatoch/helios/", "vickykatoch-helios"],
    ["  https://github.com/openmrs/openmrs-esm-core.GIT  ", "openmrs-openmrs-esm-core"],
    ["ssh://git@github.com/vickykatoch/helios.git", "vickykatoch-helios"],
    ["git@github.com:vickykatoch/helios.git", "vickykatoch-helios"],
    ["https://bitbucket.example.com/scm/PAY/payee-hub.git", "PAY-payee-hub"],
    ["https://git.example.com/acme/orders.git?ref=main#readme", "acme-orders"],
    ["https://git.example.com/orders.git", "orders"],
  ])("names %s %s", (url, name) => {
    expect(repositoryNameFromUrl(url)).toBe(name);
  });

  it.each([
    ["file:///Users/ana/fleet/mf-billing", "mf-billing"],
    ["file:///Users/ana/fleet/my%20repo/", "my repo"],
  ])("names the local %s after its directory alone: %s", (url, name) => {
    expect(repositoryNameFromUrl(url)).toBe(name);
  });

  it.each(["", "   ", "https://github.com", "https://github.com/", "file:///"])("names nothing in %j", (url) => {
    expect(repositoryNameFromUrl(url)).toBe("");
  });
});
