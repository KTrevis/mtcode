// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { ThreadId, type KanbanCard } from "@t3tools/contracts";
import { KanbanBoard, reorderKanbanCard } from "./KanbanBoard";
import { RightPanelSheet } from "./RightPanelSheet";
import { SheetTitle } from "./ui/sheet";

const initialCards: KanbanCard[] = [
  { id: "a", title: "First", column: "TODO" },
  { id: "b", title: "Second", column: "TODO" },
  { id: "c", title: "Third", column: "AI" },
  { id: "d", title: "Fourth", column: "AI" },
];
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onMove = vi.fn();
const onOpen = vi.fn();
const onAdd = vi.fn(async () => true);

function Harness({
  initial = initialCards,
  boardDisabled = false,
}: {
  initial?: KanbanCard[];
  boardDisabled?: boolean;
}) {
  const [cards, setCards] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <button>Before board</button>
      <KanbanBoard
        cards={cards}
        tags={[
          { id: "bug-id", name: "bug" },
          { id: "feature-id", name: "feature" },
        ]}
        environmentId="remote"
        disabled={boardDisabled}
        detailsOpen={selected !== null}
        onAdd={onAdd}
        onDelete={(id) => setCards((current) => current.filter((card) => card.id !== id))}
        onOpen={(id) => {
          onOpen(id);
          setSelected(id);
        }}
        onMove={async (id, column, index) => {
          onMove(id, column, index);
          setCards((current) => reorderKanbanCard(current, id, column, index));
          return true;
        }}
      />
      <button>After board</button>
      <RightPanelSheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        animationDurationMs={0}
      >
        {selected ? (
          <>
            <SheetTitle>Ticket details</SheetTitle>
            <input aria-label="Ticket title" />
          </>
        ) : null}
      </RightPanelSheet>
    </>
  );
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const board = () => container.querySelector<HTMLElement>('[aria-label="Kanban board"]')!;
const card = (id: string) => container.querySelector<HTMLElement>(`[data-kanban-card="${id}"]`)!;
const input = (column: string) =>
  container.querySelector<HTMLInputElement>(`[aria-label="New card in ${column}"]`)!;
async function focus(element: HTMLElement) {
  await act(async () => element.focus());
}
async function press(
  key: string,
  options: KeyboardEventInit = {},
  target: EventTarget = document.activeElement!,
) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  await act(async () => target.dispatchEvent(event));
  return event;
}

it("navigates within a column and chooses the closest card in the next column", async () => {
  for (const [id, top] of [
    ["a", 0],
    ["b", 100],
    ["c", 0],
    ["d", 90],
  ] as const) {
    vi.spyOn(card(id), "getBoundingClientRect").mockReturnValue({ top, height: 40 } as DOMRect);
  }
  await focus(board());
  expect(document.activeElement).toBe(card("a"));
  await press("ArrowDown");
  expect(document.activeElement).toBe(card("b"));
  await press("ArrowRight");
  expect(document.activeElement).toBe(card("d"));
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  await focus(container.querySelector<HTMLButtonElement>("button")!);
  await focus(board());
  expect(document.activeElement).toBe(card("d"));
});

it("moves and reorders cards with Shift and keeps focus on the moved card", async () => {
  await focus(card("b"));
  await press("ArrowUp", { shiftKey: true });
  expect(onMove).toHaveBeenLastCalledWith("b", "TODO", 0);
  expect(
    Array.from(
      container.querySelectorAll('[data-kanban-column="TODO"] [data-kanban-card]'),
      (element) => (element as HTMLElement).dataset.kanbanCard,
    ),
  ).toEqual(["b", "a"]);
  await press("ArrowRight", { shiftKey: true });
  expect(onMove).toHaveBeenLastCalledWith("b", "AI", 0);
  expect(document.activeElement).toBe(card("b"));
  expect(card("b").closest("[data-kanban-column]")?.getAttribute("data-kanban-column")).toBe("AI");
  await press("ArrowRight", { shiftKey: true });
  expect(document.activeElement).toBe(card("b"));
  expect(card("b").closest("[data-kanban-column]")?.getAttribute("data-kanban-column")).toBe(
    "Done",
  );
  expect(onOpen).not.toHaveBeenCalled();
});

it("handles empty columns and focuses their add field with N", async () => {
  await focus(card("d"));
  await press("ArrowRight");
  expect(
    document.activeElement?.closest("[data-kanban-column]")?.getAttribute("data-kanban-column"),
  ).toBe("Done");
  await press("n");
  expect(document.activeElement).toBe(input("Done"));
  expect((await press("ArrowLeft", { shiftKey: true })).defaultPrevented).toBe(false);
  expect((await press("n")).defaultPrevented).toBe(false);
  expect(onMove).not.toHaveBeenCalled();
});

it("leaves global shortcuts alone and prevents moving while saving or on repeat", async () => {
  await focus(card("a"));
  expect((await press("1", { metaKey: true })).defaultPrevented).toBe(false);
  expect((await press("ArrowRight", { ctrlKey: true })).defaultPrevented).toBe(false);
  await press("ArrowRight", { shiftKey: true, repeat: true });
  await act(async () => root.render(<Harness boardDisabled />));
  await press("ArrowRight", { shiftKey: true });
  expect(onMove).not.toHaveBeenCalled();
  await press("ArrowDown");
  expect(document.activeElement).toBe(card("b"));
});

it("opens with Enter and returns focus to the ticket after Escape", async () => {
  await focus(card("b"));
  await press("Enter");
  expect(onOpen).toHaveBeenCalledWith("b");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await press("Escape");
  expect(document.activeElement).toBe(card("b"));
});

it("allows adding on a completely empty board", async () => {
  await act(async () => root.render(<Harness key="empty" initial={[]} />));
  await focus(board());
  await press("ArrowRight");
  await press("n");
  expect(document.activeElement).toBe(input("AI"));
});

it("preserves card data and relative order when inserting into a column", () => {
  const cards = [
    { ...initialCards[1]!, branch: "feature", agentThreadId: ThreadId.make("thread") },
    initialCards[0]!,
    initialCards[2]!,
    initialCards[3]!,
  ];
  const moved = reorderKanbanCard(cards, "b", "AI", 1);
  expect(moved.filter((card) => card.column === "AI").map((card) => card.id)).toEqual([
    "c",
    "b",
    "d",
  ]);
  expect(moved.find((card) => card.id === "b")).toMatchObject({
    branch: "feature",
    agentThreadId: ThreadId.make("thread"),
  });
  expect(cards[0]?.column).toBe("TODO");
  expect(reorderKanbanCard(cards, "missing", "Done")).toEqual(cards);
});

it("recovers the last ticket from blank-page focus without moving it", async () => {
  await focus(card("b"));
  await act(async () => card("b").blur());
  expect(document.activeElement).toBe(document.body);
  expect((await press("ArrowDown")).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(card("b"));
  expect(onMove).not.toHaveBeenCalled();
  await press("ArrowDown", { shiftKey: true });
  expect(onMove).not.toHaveBeenCalled();
});

it("returns from an add field with Escape without clearing its draft", async () => {
  await focus(card("b"));
  await press("n");
  const field = input("TODO");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(field, "Keep this draft");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await press("Escape");
  expect(document.activeElement).toBe(card("b"));
  expect(field.value).toBe("Keep this draft");
  await press("n");
  expect(document.activeElement).toBe(field);
});

it("navigates from card actions and recovers focus after clicking column whitespace", async () => {
  await focus(card("b").querySelector<HTMLButtonElement>("button")!);
  await press("ArrowUp");
  expect(document.activeElement).toBe(card("a"));
  const column = container.querySelector<HTMLElement>('[data-kanban-column="AI"]')!;
  await act(async () =>
    column.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true })),
  );
  expect(document.activeElement).toBe(card("c"));
});

it("does not recover board focus while ticket details or other controls own input", async () => {
  await focus(card("b"));
  await press("Enter");
  expect((await press("ArrowDown", {}, document.body)).defaultPrevented).toBe(false);
  await press("Escape");
  await focus(container.querySelector<HTMLButtonElement>("button")!);
  expect((await press("ArrowDown")).defaultPrevented).toBe(false);
  await focus(input("TODO"));
  expect((await press("ArrowDown")).defaultPrevented).toBe(false);
});

it("filters tickets and navigates only visible cards while preserving hidden order", async () => {
  await act(async () =>
    root.render(
      <Harness
        key="tagged"
        initial={[
          { ...initialCards[0]!, tagIds: ["bug-id"] },
          initialCards[1]!,
          { id: "e", title: "Fifth", column: "TODO", tagIds: ["bug-id"] },
          { ...initialCards[2]!, tagIds: ["feature-id"] },
        ]}
      />,
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Filter by tags"]')!.click(),
  );
  const option = (name: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (element) => element.textContent === name,
    )!;
  await act(async () => option("bug").click());
  expect(card("b")).toBeNull();
  expect(card("c")).toBeNull();
  await press("Escape");
  await focus(board());
  expect(document.activeElement).toBe(card("a"));
  await press("ArrowDown");
  expect(document.activeElement).toBe(card("e"));
  await press("ArrowUp", { shiftKey: true });
  expect(onMove).toHaveBeenLastCalledWith("e", "TODO", 0);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Clear tag filter"]')!.click(),
  );
  expect(
    Array.from(
      container.querySelectorAll('[data-kanban-column="TODO"] [data-kanban-card]'),
      (element) => (element as HTMLElement).dataset.kanbanCard,
    ),
  ).toEqual(["e", "a", "b"]);
});

it("keeps tickets matching any checked tag and restores all tickets when unchecked", async () => {
  await act(async () =>
    root.render(
      <Harness
        key="multi-tags"
        initial={[
          { ...initialCards[0]!, tagIds: ["bug-id", "feature-id"] },
          { ...initialCards[1]!, tagIds: ["bug-id"] },
          { ...initialCards[2]!, tagIds: ["feature-id"] },
          initialCards[3]!,
        ]}
      />,
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Filter by tags"]')!.click(),
  );
  const option = (name: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (element) => element.textContent === name,
    )!;
  await act(async () => option("bug").click());
  expect(card("a")).not.toBeNull();
  expect(card("b")).not.toBeNull();
  expect(card("c")).toBeNull();
  expect(card("d")).toBeNull();
  expect(option("bug").getAttribute("aria-selected")).toBe("true");
  await act(async () => option("feature").click());
  expect(card("c")).not.toBeNull();
  expect(container.querySelectorAll('[data-kanban-card="a"]')).toHaveLength(1);
  expect(card("d")).toBeNull();
  await act(async () => option("bug").click());
  expect(card("a")).not.toBeNull();
  expect(card("b")).toBeNull();
  expect(card("c")).not.toBeNull();
  await act(async () => option("feature").click());
  expect(card("d")).not.toBeNull();
  expect(container.querySelector('[aria-label="Clear tag filter"]')).toBeNull();
});

async function searchTickets(query: string) {
  const field = container.querySelector<HTMLInputElement>('[aria-label="Search tickets"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(field, query);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return field;
}

it("filters titles, descriptions and branches across columns without changing the cards", async () => {
  await act(async () =>
    root.render(
      <Harness
        key="search"
        initial={[
          { id: "a", title: "Fix SEARCH", column: "TODO" },
          { id: "b", title: "Second", description: "Search the tickets", column: "AI" },
          { id: "c", title: "Third", branch: "feature/search", column: "Done" },
          { id: "d", title: "Other ticket", column: "TODO" },
        ]}
      />,
    ),
  );
  await searchTickets("  sEaRcH  ");
  expect(
    Array.from(container.querySelectorAll("[data-kanban-card]"), (el) =>
      el.getAttribute("data-kanban-card"),
    ),
  ).toEqual(["a", "b", "c"]);
  for (const column of ["TODO", "AI", "Done"]) {
    expect(container.querySelector(`[data-kanban-column="${column}"] h2 span`)?.textContent).toBe(
      "1",
    );
  }
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Clear ticket search"]')!.click(),
  );
  expect(container.querySelectorAll("[data-kanban-card]")).toHaveLength(4);
  await searchTickets("   ");
  expect(container.querySelectorAll("[data-kanban-card]")).toHaveLength(4);
  expect(onMove).not.toHaveBeenCalled();
});

it("shows an empty search state and restores all tickets with Escape", async () => {
  const field = await searchTickets("no matching ticket");
  expect(container.querySelectorAll("[data-kanban-card]")).toHaveLength(0);
  expect(container.querySelector('p[role="status"]')?.textContent).toContain("No tickets match");
  await focus(field);
  expect((await press("ArrowDown")).defaultPrevented).toBe(false);
  await press("Escape");
  expect(document.activeElement).toBe(field);
  expect(field.value).toBe("");
  expect(container.querySelectorAll("[data-kanban-card]")).toHaveLength(4);
  expect(container.querySelector('p[role="status"]')).toBeNull();
});

it("navigates and reorders matching tickets using their positions in the full column", async () => {
  await act(async () =>
    root.render(
      <Harness
        key="filtered-navigation"
        initial={[
          { id: "a", title: "Match one", column: "TODO" },
          { id: "b", title: "Hidden", column: "TODO" },
          { id: "c", title: "Match two", column: "TODO" },
          { id: "d", title: "Match three", column: "TODO" },
        ]}
      />,
    ),
  );
  await focus(card("b"));
  await searchTickets("match");
  await focus(container.querySelector<HTMLButtonElement>("button")!);
  await focus(board());
  expect(document.activeElement).toBe(card("a"));
  await press("ArrowDown");
  expect(document.activeElement).toBe(card("c"));
  await press("ArrowUp");
  expect(document.activeElement).toBe(card("a"));
  await press("ArrowDown", { shiftKey: true });
  expect(onMove).toHaveBeenLastCalledWith("a", "TODO", 2);
  expect(document.activeElement).toBe(card("a"));
  await searchTickets("");
  expect(
    Array.from(container.querySelectorAll("[data-kanban-card]"), (el) =>
      el.getAttribute("data-kanban-card"),
    ),
  ).toEqual(["b", "c", "a", "d"]);
});

it("combines ticket search with the selected tags", async () => {
  await act(async () =>
    root.render(
      <Harness
        key="combined-filters"
        initial={[
          { id: "a", title: "Match bug", column: "TODO", tagIds: ["bug-id"] },
          { id: "b", title: "Other bug", column: "TODO", tagIds: ["bug-id"] },
          { id: "c", title: "Match feature", column: "TODO", tagIds: ["feature-id"] },
        ]}
      />,
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Filter by tags"]')!.click(),
  );
  const bug = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (element) => element.textContent === "bug",
  )!;
  await act(async () => bug.click());
  await press("Escape");
  await searchTickets("match");
  expect(card("a")).not.toBeNull();
  expect(card("b")).toBeNull();
  expect(card("c")).toBeNull();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Clear ticket search"]')!.click(),
  );
  expect(card("b")).not.toBeNull();
  expect(card("c")).toBeNull();
});
