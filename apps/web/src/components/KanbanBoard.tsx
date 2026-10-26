import { unfinishedKanbanDependencies } from "@t3tools/shared/kanban";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";
import { Link } from "@tanstack/react-router";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { KanbanCard, KanbanTag } from "@t3tools/contracts";
import {
  CheckIcon,
  LockKeyholeIcon,
  ChevronDownIcon,
  GitBranchIcon,
  ListFilterIcon,
  MessageSquareIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { CheckboxCombobox } from "./ui/checkbox-combobox";
import { isEditableFocused } from "../lib/editableFocus";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { useKanbanMoves } from "../hooks/useKanbanMoves";

const KANBAN_COLUMNS = ["TODO", "AI", "Done"] as const;
export type KanbanColumn = (typeof KANBAN_COLUMNS)[number];

function Card({
  card,
  blockers,
  tags,
  environmentId,
  disabled,
  moveDisabled,
  onOpen,
  onDelete,
  active,
  onFocus,
}: {
  card: KanbanCard;
  blockers: readonly KanbanCard[];
  tags: readonly KanbanTag[];
  environmentId: string;
  disabled: boolean;
  moveDisabled: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  active: boolean;
  onFocus: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    disabled: moveDisabled,
  });

  const dependencyStatus = blockers.length
    ? `Blocked by: ${blockers.map((dependency) => dependency.title).join(", ")}`
    : "All dependencies are done";

  return (
    <div
      ref={setNodeRef}
      className="group/kanban-card relative shrink-0 cursor-pointer rounded-lg bg-muted/50 px-2 py-2 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
      style={{ opacity: isDragging ? 0 : 1 }}
      {...attributes}
      {...listeners}
      data-kanban-card={card.id}
      tabIndex={active ? 0 : -1}
      onFocus={onFocus}
      aria-label={`${card.title}, ${card.column}${card.dependsOn?.length ? `, ${dependencyStatus}` : ""}`}
      onClick={(event) => {
        if (!isDragging) {
          event.currentTarget.focus();
          onOpen(card.id);
        }
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter") {
          event.preventDefault();
          onOpen(card.id);
        }
      }}
    >
      <div className="min-w-0">
        <span className="break-words">{card.title}</span>
        {card.dependsOn?.length ? (
          <div className="mt-1 flex">
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    tabIndex={active ? 0 : -1}
                    role="img"
                    aria-label={dependencyStatus}
                    className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  />
                }
              >
                {blockers.length ? (
                  <>
                    <LockKeyholeIcon aria-hidden="true" className="size-3" />
                    <span aria-hidden="true">{blockers.length}</span>
                  </>
                ) : (
                  <CheckIcon aria-hidden="true" className="size-3" />
                )}
              </TooltipTrigger>
              <TooltipPopup>{dependencyStatus}</TooltipPopup>
            </Tooltip>
          </div>
        ) : null}
        {card.tagIds?.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {card.tagIds.map((id) => (
              <span
                key={id}
                className="max-w-full truncate rounded bg-accent px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                {tags.find((tag) => tag.id === id)?.name ?? id}
              </span>
            ))}
          </div>
        ) : null}
        {card.branch ? (
          <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <GitBranchIcon className="size-3 shrink-0" />
            <span className="truncate">{card.branch}</span>
          </span>
        ) : null}
      </div>
      <div className="pointer-events-none absolute top-1 right-1 z-10 flex items-center gap-1 rounded-md bg-muted p-0.5 opacity-0 group-hover/kanban-card:pointer-events-auto group-hover/kanban-card:opacity-100 group-focus-within/kanban-card:pointer-events-auto group-focus-within/kanban-card:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
        {card.agentThreadId ? (
          <Link
            to="/$environmentId/$threadId"
            params={{ environmentId, threadId: card.agentThreadId }}
            aria-label={`Open agent thread for ${card.title}`}
            className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <MessageSquareIcon className="size-4" />
          </Link>
        ) : null}
        <button
          type="button"
          aria-label={`Delete ${card.title}`}
          className="cursor-pointer rounded p-1 text-muted-foreground hover:text-destructive-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onDelete(card.id);
          }}
        >
          <Trash2Icon className="size-4" />
        </button>
      </div>
    </div>
  );
}

function ColumnView({
  column,
  cards,
  allCards,
  tags,
  environmentId,
  disabled,
  moveDisabled,
  onAdd,
  onOpen,
  onDelete,
  activeCardId,
  onCardFocus,
}: {
  column: KanbanColumn;
  cards: readonly KanbanCard[];
  allCards: readonly KanbanCard[];
  tags: readonly KanbanTag[];
  environmentId: string;
  disabled: boolean;
  moveDisabled: boolean;
  onAdd: (title: string, column: KanbanColumn, tagIds?: string[]) => Promise<boolean>;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  activeCardId: string | null;
  onCardFocus: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  const [title, setTitle] = useState("");
  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || disabled) return;
    if (await onAdd(title.trim(), column)) setTitle("");
  };

  return (
    <section
      ref={setNodeRef}
      data-kanban-column={column}
      className={`flex h-full min-h-0 w-72 shrink-0 flex-col gap-3 rounded-lg p-2 ${isOver ? "bg-accent/50" : ""}`}
    >
      <h2
        tabIndex={-1}
        className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring flex items-center gap-2 px-1 text-sm font-semibold"
      >
        {column}
        <span className="text-xs font-normal text-muted-foreground">{cards.length}</span>
      </h2>
      <form onSubmit={add} className="flex shrink-0 items-center gap-1">
        <Input
          nativeInput
          aria-label={`New card in ${column}`}
          placeholder="Add a card"
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={disabled}
          size="sm"
        />
        <Button
          type="submit"
          size="icon-xs"
          variant="ghost-muted"
          disabled={disabled || !title.trim()}
          aria-label={`Add card to ${column}`}
        >
          <PlusIcon className="size-4" />
        </Button>
      </form>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {cards.map((card) => (
          <Card
            key={card.id}
            card={card}
            blockers={unfinishedKanbanDependencies(card, allCards)}
            tags={tags}
            environmentId={environmentId}
            disabled={disabled}
            moveDisabled={moveDisabled}
            onOpen={onOpen}
            onDelete={onDelete}
            active={activeCardId === card.id}
            onFocus={() => onCardFocus(card.id)}
          />
        ))}
      </div>
    </section>
  );
}

export function reorderKanbanCard(
  cards: readonly KanbanCard[],
  id: string,
  column: KanbanColumn,
  index?: number,
): KanbanCard[] {
  const card = cards.find((candidate) => candidate.id === id);
  if (!card) return [...cards];
  const remaining = cards.filter((candidate) => candidate.id !== id);
  const siblings = remaining.filter((candidate) => candidate.column === column);
  const before = index === undefined ? undefined : siblings[Math.max(0, index)];
  const insertion = before
    ? remaining.findIndex((candidate) => candidate.id === before.id)
    : siblings.length
      ? remaining.findIndex((candidate) => candidate.id === siblings.at(-1)!.id) + 1
      : remaining.length;
  remaining.splice(insertion, 0, { ...card, column });
  return remaining;
}

export function KanbanBoard({
  cards: savedCards,
  tags,
  environmentId,
  disabled,
  moveDisabled = disabled,
  detailsOpen = false,
  onAdd,
  onOpen,
  onDelete,
  onMove: persistMove,
}: {
  cards: readonly KanbanCard[];
  tags: readonly KanbanTag[];
  environmentId: string;
  disabled: boolean;
  moveDisabled?: boolean;
  onAdd: (title: string, column: KanbanColumn, tagIds?: string[]) => Promise<boolean>;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  detailsOpen?: boolean;
  onMove: (id: string, column: KanbanColumn, index?: number) => Promise<boolean>;
}) {
  const { moves, enqueue: onMove } = useKanbanMoves(disabled, persistMove);
  const allCards = moves.reduce(
    (current, move) => reorderKanbanCard(current, move.id, move.column, move.index),
    savedCards,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const query = searchQuery.trim().toLowerCase();
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const cards = allCards.filter(
    (card) =>
      (!selectedTagIds.length || card.tagIds?.some((id) => selectedTagIds.includes(id))) &&
      (!query ||
        [card.title, card.description, card.branch].some((text) =>
          text?.toLowerCase().includes(query),
        )),
  );
  const boardRef = useRef<HTMLDivElement>(null);
  const movingCardId = useRef<string | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [activeColumn, setActiveColumn] = useState<KanbanColumn>("TODO");
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const draggedCard = cards.find((card) => card.id === draggedCardId);
  const currentCardId = cards.some((card) => card.id === activeCardId)
    ? activeCardId
    : (cards[0]?.id ?? null);

  const cardElement = (id: string) =>
    Array.from(boardRef.current?.querySelectorAll<HTMLElement>("[data-kanban-card]") ?? []).find(
      (element) => element.dataset.kanbanCard === id,
    );
  const columnElement = (column: KanbanColumn) =>
    boardRef.current?.querySelector<HTMLElement>(`[data-kanban-column="${column}"]`);
  const focusCard = (id: string) => {
    const element = cardElement(id);
    element?.focus();
    element?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const focusColumn = (column: KanbanColumn) => {
    const element = columnElement(column)?.querySelector<HTMLElement>("h2");
    element?.focus();
    element?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const recoverBoardFocus = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (
      detailsOpen ||
      isCommandPaletteOpen() ||
      event.defaultPrevented ||
      event.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      draggedCardId ||
      (event.target !== document.body && event.target !== document.documentElement) ||
      (!event.key.startsWith("Arrow") && event.key !== "Escape")
    )
      return;
    event.preventDefault();
    if (currentCardId) focusCard(currentCardId);
    else focusColumn(activeColumn);
  });
  // oxlint-disable-next-line t3code/react-effect-budget -- Restore board keyboard focus when a document-level key event arrives outside controls.
  useEffect(() => {
    window.addEventListener("keydown", recoverBoardFocus);
    return () => window.removeEventListener("keydown", recoverBoardFocus);
  }, []);

  // oxlint-disable-next-line t3code/react-effect-budget -- Restore DOM focus after persisted cards move between columns.
  useLayoutEffect(() => {
    const id = movingCardId.current;
    if (!id || !cards.some((card) => card.id === id)) return;
    movingCardId.current = null;
    if (
      document.activeElement === document.body ||
      boardRef.current?.contains(document.activeElement)
    ) {
      const element = Array.from(
        boardRef.current?.querySelectorAll<HTMLElement>("[data-kanban-card]") ?? [],
      ).find((candidate) => candidate.dataset.kanbanCard === id);
      element?.focus();
      element?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [cards]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      draggedCardId
    )
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (currentCardId) focusCard(currentCardId);
      else focusColumn(activeColumn);
      return;
    }
    if (isEditableFocused(event.target)) return;
    const target = event.target as HTMLElement;
    const focusedCard = target.closest<HTMLElement>("[data-kanban-card]");
    const focusedCardId = focusedCard?.dataset.kanbanCard;
    if (event.key.toLowerCase() === "n" && !event.shiftKey) {
      event.preventDefault();
      if (!disabled) columnElement(activeColumn)?.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    if (!event.key.startsWith("Arrow")) return;
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const card = cards.find((candidate) => candidate.id === focusedCardId);
    const column = card?.column ?? activeColumn;
    const siblings = cards.filter((candidate) => candidate.column === column);
    const index = siblings.findIndex((candidate) => candidate.id === card?.id);
    const destination = horizontal
      ? KANBAN_COLUMNS[KANBAN_COLUMNS.indexOf(column) + direction]
      : column;
    event.preventDefault();
    if (!destination) return;
    if (event.shiftKey) {
      if (
        !card ||
        moveDisabled ||
        event.repeat ||
        (!horizontal && (index + direction < 0 || index + direction >= siblings.length))
      )
        return;
      movingCardId.current = card.id;
      const visibleIndex = horizontal ? Math.max(0, index) : index + direction;
      const before = cards.filter(
        (candidate) => candidate.id !== card.id && candidate.column === destination,
      )[visibleIndex];
      const remaining = allCards.filter(
        (candidate) => candidate.id !== card.id && candidate.column === destination,
      );
      const destinationIndex =
        query || selectedTagIds.length
          ? before
            ? remaining.findIndex((candidate) => candidate.id === before.id)
            : remaining.length
          : visibleIndex;
      void onMove(card.id, destination, destinationIndex).then((moved) => {
        if (!moved) movingCardId.current = null;
      });
      return;
    }
    if (!horizontal) {
      const next =
        siblings[index < 0 ? (direction > 0 ? 0 : siblings.length - 1) : index + direction];
      if (next) focusCard(next.id);
      return;
    }
    const candidates = Array.from(
      columnElement(destination)?.querySelectorAll<HTMLElement>("[data-kanban-card]") ?? [],
    );
    if (!candidates.length) {
      focusColumn(destination);
      return;
    }
    const bounds = (focusedCard ?? target).getBoundingClientRect();
    const center = bounds.top + bounds.height / 2;
    const distance = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return Math.abs(rect.top + rect.height / 2 - center);
    };
    const closest = candidates.reduce((best, candidate) =>
      distance(candidate) < distance(best) ? candidate : best,
    );
    closest.focus();
    closest.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex w-full max-w-sm shrink-0 items-center gap-1">
        <Input
          nativeInput
          type="search"
          aria-label="Search tickets"
          placeholder="Search tickets…"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setSearchQuery("");
            }
          }}
        />
        {searchQuery ? (
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label="Clear ticket search"
            onClick={() => setSearchQuery("")}
          >
            <XIcon className="size-4" />
          </Button>
        ) : null}
      </div>
      {query && cards.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          No tickets match your search.
        </p>
      ) : null}

      {tags.length > 0 || selectedTagIds.length > 0 ? (
        <div
          className="flex shrink-0 flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter by tag"
        >
          <CheckboxCombobox
            items={tags.map((tag) => ({ id: tag.id, label: tag.name }))}
            selectedIds={selectedTagIds}
            onChange={setSelectedTagIds}
            ariaLabel="Filter by tags"
            searchPlaceholder="Search tags…"
            emptyMessage="No tags found."
            triggerLabel={
              <>
                <ListFilterIcon className="size-4" />
                {selectedTagIds.length ? `Tags · ${selectedTagIds.length}` : "All tags"}
                <ChevronDownIcon className="size-3" />
              </>
            }
          />
          {selectedTagIds.length ? (
            <Button
              size="xs"
              variant="ghost-muted"
              aria-label="Clear tag filter"
              onClick={() => setSelectedTagIds([])}
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}
      {!query && selectedTagIds.length > 0 && cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tickets with these tags. Choose other tags or clear the filter.
        </p>
      ) : null}
      <DndContext
        sensors={sensors}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Use arrow keys to navigate tickets, Enter to open, Shift and arrow keys to move, and N to add a ticket.",
          },
        }}
        onDragStart={({ active }) => setDraggedCardId(String(active.id))}
        onDragEnd={({ active, over }) => {
          setDraggedCardId(null);
          if (
            over &&
            over.id !== draggedCard?.column &&
            KANBAN_COLUMNS.includes(over.id as KanbanColumn)
          )
            void onMove(String(active.id), over.id as KanbanColumn);
        }}
        onDragCancel={() => setDraggedCardId(null)}
      >
        <div
          ref={boardRef}
          role="group"
          aria-label="Kanban board"
          tabIndex={0}
          className="flex min-h-0 flex-1 gap-4 outline-none"
          onKeyDown={handleKeyDown}
          onPointerDown={(event) => {
            const target = event.target as HTMLElement;
            if (
              target.closest(
                "[data-kanban-card], button, a, input, textarea, select, [contenteditable]",
              )
            )
              return;
            const column = target.closest<HTMLElement>("[data-kanban-column]")?.dataset
              .kanbanColumn as KanbanColumn | undefined;
            const card =
              cards.find(
                (candidate) =>
                  candidate.id === currentCardId && (!column || candidate.column === column),
              ) ?? cards.find((candidate) => !column || candidate.column === column);
            if (card) focusCard(card.id);
            else focusColumn(column ?? activeColumn);
            event.preventDefault();
          }}
          onFocusCapture={(event) => {
            const section = (event.target as HTMLElement).closest<HTMLElement>(
              "[data-kanban-column]",
            );
            if (section) setActiveColumn(section.dataset.kanbanColumn as KanbanColumn);
          }}
          onFocus={(event) => {
            if (
              event.target !== event.currentTarget ||
              event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              return;
            if (currentCardId) focusCard(currentCardId);
            else focusColumn(activeColumn);
          }}
        >
          {KANBAN_COLUMNS.map((column) => (
            <ColumnView
              key={column}
              column={column}
              tags={tags}
              cards={cards.filter((card) => card.column === column)}
              allCards={allCards}
              environmentId={environmentId}
              disabled={disabled}
              moveDisabled={moveDisabled}
              activeCardId={currentCardId}
              onCardFocus={setActiveCardId}
              onAdd={(title, column) =>
                onAdd(
                  title,
                  column,
                  selectedTagIds.length ? selectedTagIds.slice(0, 10) : undefined,
                )
              }
              onOpen={onOpen}
              onDelete={onDelete}
            />
          ))}
        </div>
        {createPortal(
          <DragOverlay zIndex={100}>
            {draggedCard ? (
              <div className="w-full cursor-grabbing rounded-lg bg-muted px-2 py-2 text-sm shadow-lg">
                <span className="break-words">{draggedCard.title}</span>
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </div>
  );
}
