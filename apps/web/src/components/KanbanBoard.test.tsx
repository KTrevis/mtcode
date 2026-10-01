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
