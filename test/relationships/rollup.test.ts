import { describe, expect, it } from "vitest";
import { type SystemRepository, runtimeSystems } from "@/lib/relationships/placement";
import { groupKey, rollUp, systemGroups } from "@/lib/relationships/rollup";

const repository = (nodeId: string): SystemRepository => ({ nodeId, label: nodeId });
const edge = (from: string, to: string, edgeId = `${from}->${to}`) => ({ edgeId, from, to });

describe("rollup", () => {
  it("rolls three relationships into one between two runtime systems (Relationships roll up into groups)", () => {
    const systems = runtimeSystems(
      ["access-shell", "fx-board", "rates", "tokens-app", "tokens"].map(repository),
      [
        { from: "access-shell", to: "fx-board", type: "composition" },
        { from: "access-shell", to: "rates", type: "composition" },
        { from: "tokens-app", to: "tokens", type: "iframe" },
      ],
    );
    const rollup = rollUp(systemGroups(systems), [edge("access-shell", "tokens"), edge("fx-board", "tokens"), edge("rates", "tokens-app")]);

    expect(rollup.relationships).toEqual([{ from: groupKey.system("access-shell"), to: groupKey.system("tokens"), repositoryRelationships: 3, edgeIds: ["access-shell->tokens", "fx-board->tokens", "rates->tokens-app"] }]);
    expect(rollup.groups.map((group) => [group.key, group.repositories])).toEqual([
      [groupKey.system("access-shell"), 3],
      [groupKey.system("tokens"), 2],
    ]);
    expect(rollup.total).toBe(5);
  });

  it("folds a relationship between two repositories of one runtime system into it (Relationship inside a group)", () => {
    const systems = runtimeSystems([repository("shell"), repository("widget")], [{ from: "shell", to: "widget", type: "composition" }]);
    const rollup = rollUp(systemGroups(systems), [edge("shell", "widget"), edge("widget", "shell")]);

    expect(rollup.relationships).toEqual([]);
    expect(rollup.groups).toEqual([{ key: groupKey.system("shell"), label: "shell", repositories: 2, internal: 2 }]);
  });

  it("counts two rules between the same repositories as one repository relationship", () => {
    const systems = runtimeSystems([repository("shell"), repository("fx-board")], []);
    const rollup = rollUp(systemGroups(systems), [edge("shell", "fx-board", "edge-1"), edge("shell", "fx-board", "edge-2")]);

    expect(rollup.relationships).toEqual([{ from: groupKey.system("shell"), to: groupKey.system("fx-board"), repositoryRelationships: 1, edgeIds: ["edge-1", "edge-2"] }]);
  });
});
