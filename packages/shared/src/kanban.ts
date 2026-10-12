import type { KanbanCard } from "@t3tools/contracts";

export function kanbanDependencyError(cards: readonly KanbanCard[]): string | null {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): string | null {
    if (visiting.has(id)) return "Ticket dependencies must not contain cycles.";
    if (visited.has(id)) return null;
    const card = byId.get(id);
    if (!card) return "Dependencies must refer to tickets in the same project.";
    const dependencies = card.dependsOn ?? [];
    if (new Set(dependencies).size !== dependencies.length)
      return "Ticket dependencies must be unique.";
    visiting.add(id);
    for (const dependency of dependencies) {
      const error = visit(dependency);
      if (error) return error;
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  }
  for (const card of cards) {
    const error = visit(card.id);
    if (error) return error;
  }
  return null;
}

export function unfinishedKanbanDependencies(card: KanbanCard, cards: readonly KanbanCard[]) {
  return cards.filter(
    (candidate) => card.dependsOn?.includes(candidate.id) && candidate.column !== "Done",
  );
}

export function removeKanbanCard(cards: readonly KanbanCard[], id: string): KanbanCard[] {
  return cards
    .filter((card) => card.id !== id)
    .map((card) =>
      card.dependsOn?.includes(id)
        ? { ...card, dependsOn: card.dependsOn.filter((dependency) => dependency !== id) }
        : card,
    );
}
