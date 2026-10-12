import { applyNodeChanges, type Node } from "@xyflow/react";
import { expect, it } from "vite-plus/test";
import type { KanbanCard } from "@t3tools/contracts";
import {
  connectKanbanTickets,
  disconnectKanbanTickets,
  layoutKanbanTickets,
  reconcileKanbanGraphNodes,
} from "./kanbanGraphUtils";

const cards: KanbanCard[] = [
  { id: "base", title: "Base", column: "Done", description: "Keep me" },
  { id: "api", title: "API", column: "TODO", dependsOn: ["base"] },
  { id: "ui", title: "UI", column: "TODO", dependsOn: ["api"], tagIds: ["frontend"] },
  { id: "independent", title: "Independent", column: "TODO" },
];

it("connects prerequisite to dependent and preserves the ticket's other data", () => {
  const connected = connectKanbanTickets(cards, "base", "ui")!;
  expect(connected.find((card) => card.id === "ui")).toEqual({
    ...cards[2],
    dependsOn: ["api", "base"],
  });
  expect(cards[2]!.dependsOn).toEqual(["api"]);
  expect(connected[0]).toEqual(cards[0]);
});

it("rejects cycles, self-links, duplicate links, and missing endpoints", () => {
  for (const [source, target] of [
    ["ui", "base"],
    ["base", "base"],
    ["base", "api"],
    ["missing", "ui"],
    ["base", "missing"],
  ]) {
    expect(connectKanbanTickets(cards, source!, target!)).toBeNull();
  }
});

it("removes only selected connections, including several prerequisites of the same ticket", () => {
  const connected = connectKanbanTickets(cards, "base", "ui")!;
  const disconnected = disconnectKanbanTickets(connected, [
    { source: "api", target: "ui" },
    { source: "base", target: "ui" },
  ]);
  expect(disconnected[2]).toEqual({ ...cards[2], dependsOn: [] });
  expect(disconnected[1]).toEqual(cards[1]);
  expect(connected[2]!.dependsOn).toEqual(["api", "base"]);
});

it("lays out prerequisites before dependents without overlapping unrelated tickets", () => {
  const layout = layoutKanbanTickets(cards.toReversed());
  expect(layout.base!.x).toBeLessThan(layout.api!.x);
  expect(layout.api!.x).toBeLessThan(layout.ui!.x);
  expect(layout.base).not.toEqual(layout.independent);
  expect(layoutKanbanTickets([])).toEqual({});
});

it("keeps all measured nodes visible across drag updates, ticket refreshes, and arrangement", () => {
  const initial: Node[] = cards.map((card) => ({
    id: card.id,
    data: { title: card.title },
    position: { x: 0, y: 0 },
  }));
  const measured = applyNodeChanges(
    initial.map((node) => ({
      type: "dimensions" as const,
      id: node.id,
      dimensions: { width: 240, height: 100 },
    })),
    initial,
  );
  const moved = applyNodeChanges(
    [
      { type: "select", id: "api", selected: true },
      { type: "position", id: "api", position: { x: 123, y: 456 }, dragging: true },
    ],
    reconcileKanbanGraphNodes(initial, measured),
  );
  const refreshed = reconcileKanbanGraphNodes(
    initial.map((node) => ({
      ...node,
      data: { title: `${node.data.title} updated` },
    })),
    moved,
  );
  expect(refreshed).toHaveLength(cards.length);
  for (const node of refreshed) {
    expect(node.measured).toEqual({ width: 240, height: 100 });
    expect(node.data.title).toContain("updated");
  }
  expect(refreshed.find((node) => node.id === "api")!.position).toEqual({ x: 123, y: 456 });
  expect(refreshed.find((node) => node.id === "api")).toMatchObject({
    selected: true,
    dragging: true,
  });
  const arranged = refreshed.map((node) => ({ ...node, position: { x: 10, y: 20 } }));
  const afterArrange = reconcileKanbanGraphNodes(initial, arranged);
  expect(afterArrange.every((node) => node.measured?.width === 240 && node.position.x === 10)).toBe(
    true,
  );
});
