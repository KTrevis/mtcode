import type { Node } from "@xyflow/react";
import type { KanbanCard } from "@t3tools/contracts";
import { kanbanDependencyError } from "@t3tools/shared/kanban";

/** An arrow from prerequisite to ticket adds the prerequisite to that ticket. */
export function connectKanbanTickets(cards: readonly KanbanCard[], source: string, target: string) {
  if (source === target || !cards.some((card) => card.id === source)) return null;
  const ticket = cards.find((card) => card.id === target);
  if (!ticket || ticket.dependsOn?.includes(source)) return null;
  const next = cards.map((card) =>
    card.id === target ? { ...card, dependsOn: [...(card.dependsOn ?? []), source] } : card,
  );
  return kanbanDependencyError(next) ? null : next;
}

export function disconnectKanbanTickets(
  cards: readonly KanbanCard[],
  connections: readonly { source: string; target: string }[],
) {
  return cards.map((card) => {
    const sources = connections
      .filter((connection) => connection.target === card.id)
      .map((connection) => connection.source);
    return sources.length
      ? { ...card, dependsOn: (card.dependsOn ?? []).filter((id) => !sources.includes(id)) }
      : card;
  });
}

/** Put prerequisites to the left of the tickets that depend on them. */
export function layoutKanbanTickets(cards: readonly KanbanCard[]) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const levels = new Map<string, number>();
  function level(id: string): number {
    const cached = levels.get(id);
    if (cached !== undefined) return cached;
    levels.set(id, 0);
    const dependencies = byId.get(id)?.dependsOn ?? [];
    const result = dependencies.length ? 1 + Math.max(...dependencies.map(level)) : 0;
    levels.set(id, result);
    return result;
  }
  const rows = new Map<number, number>();
  return Object.fromEntries(
    cards.map((card) => {
      const column = level(card.id);
      const row = rows.get(column) ?? 0;
      rows.set(column, row + 1);
      return [card.id, { x: column * 320, y: row * 160 }];
    }),
  );
}

/** Keep React Flow measurements and dragged positions when ticket data changes. */
export function reconcileKanbanGraphNodes<T extends Node>(
  incoming: readonly T[],
  current: readonly T[],
): T[] {
  const byId = new Map(current.map((node) => [node.id, node]));
  return incoming.map((node) => {
    const existing = byId.get(node.id);
    return { ...existing, ...node, position: existing?.position ?? node.position };
  });
}
