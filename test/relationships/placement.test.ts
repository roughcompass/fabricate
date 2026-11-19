import { describe, expect, it } from "vitest";
import { type SystemRepository, runtimeSystems } from "@/lib/relationships/placement";

const repository = (nodeId: string): SystemRepository => ({ nodeId, label: nodeId });

describe("runtime systems", () => {
  it("groups linked repositories into one runtime system named for its host, and leaves an unlinked one alone", () => {
    const systems = runtimeSystems(
      [repository("orders"), repository("shell"), repository("reports"), repository("tools")],
      [
        { from: "shell", to: "orders", type: "composition" },
        { from: "shell", to: "reports", type: "composition" },
        { from: "orders", to: "reports", type: "runtime_contract" },
      ],
    );

    expect(systems).toEqual([
      { id: "shell", name: "shell", host: "shell", members: ["orders", "reports", "shell"] },
      { id: "tools", name: "tools", host: null, members: ["tools"] },
    ]);
  });

  it("names a system with no host for its first repository by name", () => {
    const systems = runtimeSystems([repository("b-iframe"), repository("a-embedded")], [{ from: "b-iframe", to: "a-embedded", type: "iframe" }]);

    expect(systems.map((system) => [system.name, system.host])).toEqual([["a-embedded", null]]);
  });

  it("ignores links to repositories outside the Run and links from a repository to itself", () => {
    const systems = runtimeSystems([repository("shell"), repository("widget")], [
      { from: "shell", to: "elsewhere", type: "composition" },
      { from: "widget", to: "widget", type: "composition" },
    ]);

    expect(systems.map((system) => system.members)).toEqual([["shell"], ["widget"]]);
  });
});
