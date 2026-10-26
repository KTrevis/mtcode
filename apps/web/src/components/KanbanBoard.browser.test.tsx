import { useState } from "react";
import { act, render } from "../../test/render";
import { expect, it, vi } from "vite-plus/test";
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
async function setup() {
  await using stack = new AsyncDisposableStack();
  stack.defer(() => {
    vi.restoreAllMocks();
  });
  stack.use(vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => undefined));
  const onMove = vi.fn();
  const onOpen = vi.fn();
  const onAdd = vi.fn(async () => true);

  function deferredMove() {
    let resolve!: (moved: boolean) => void;
    const promise = new Promise<boolean>((complete) => {
      resolve = complete;
    });
    return { promise, resolve };
  }

  function Harness({
    initial = initialCards,
    boardDisabled = false,
    persistMove,
  }: {
    initial?: KanbanCard[];
    boardDisabled?: boolean;
    persistMove?: (id: string) => Promise<boolean>;
  }) {
    const [cards, setCards] = useState(initial);
    const [saving, setSaving] = useState(false);
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
          disabled={boardDisabled || saving}
          moveDisabled={boardDisabled}
          detailsOpen={selected !== null}
          onAdd={onAdd}
          onDelete={(id) => setCards((current) => current.filter((card) => card.id !== id))}
          onOpen={(id) => {
            onOpen(id);
            setSelected(id);
          }}
          onMove={async (id, column, index) => {
            onMove(id, column, index);
            if (persistMove) {
              setSaving(true);
              const moved = await persistMove(id);
              setSaving(false);
              if (!moved) return false;
            }
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

  const screen = stack.use(await render(<Harness />));
  const container = screen.container;
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
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    await act(async () => target.dispatchEvent(event));
    return event;
  }

  async function searchTickets(query: string) {
    const field = container.querySelector<HTMLInputElement>('[aria-label="Search tickets"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(field, query);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return field;
  }

  return Object.assign(stack.move(), {
    deferredMove,
    screen,
    container,
    Harness,
    onMove,
    onOpen,
    onAdd,
    board,
    card,
    input,
    focus,
    press,
    searchTickets,
  });
}

it("navigates within a column and chooses the closest card in the next column", async () => {
  await using fixture = await setup();
  const { container, board, card, focus, press } = fixture;
  for (const [id, top] of [
    ["a", 0],
    ["b", 100],
    ["c", 0],
    ["d", 90],
  ] as const) {
    vi.spyOn(card(id), "getBoundingClientRect").mockReturnValue({ top, height: 40 } as DOMRect);
  }
  await focus(board());
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("a"));
  });
  await press("ArrowDown");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("b"));
  });
  await press("ArrowRight");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("d"));
  });
  await vi.waitFor(() => {
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });
  await focus(container.querySelector<HTMLButtonElement>("button")!);
  await focus(board());
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("d"));
  });
});

it("moves and reorders cards with Shift and keeps focus on the moved card", async () => {
  await using fixture = await setup();
  const { container, onMove, onOpen, card, focus, press } = fixture;
  await focus(card("b"));
  await press("ArrowUp", { shiftKey: true });
  await vi.waitFor(() => {
    expect(onMove).toHaveBeenLastCalledWith("b", "TODO", 0);
  });
  await vi.waitFor(() => {
    expect(
      Array.from(
        container.querySelectorAll('[data-kanban-column="TODO"] [data-kanban-card]'),
        (element) => (element as HTMLElement).dataset.kanbanCard,
      ),
    ).toEqual(["b", "a"]);
  });
  await press("ArrowRight", { shiftKey: true });
  await vi.waitFor(() => {
    expect(onMove).toHaveBeenLastCalledWith("b", "AI", 0);
  });
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("b"));
  });
  await vi.waitFor(() => {
    expect(card("b").closest("[data-kanban-column]")?.getAttribute("data-kanban-column")).toBe(
      "AI",
    );
  });
  await press("ArrowRight", { shiftKey: true });
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("b"));
  });
  await vi.waitFor(() => {
    expect(card("b").closest("[data-kanban-column]")?.getAttribute("data-kanban-column")).toBe(
      "Done",
    );
  });
  await vi.waitFor(() => {
    expect(onOpen).not.toHaveBeenCalled();
  });
});

it("handles empty columns and focuses their add field with N", async () => {
  await using fixture = await setup();
  const { onMove, card, input, focus, press } = fixture;
  await focus(card("d"));
  await press("ArrowRight");
  await vi.waitFor(() => {
    expect(
      document.activeElement?.closest("[data-kanban-column]")?.getAttribute("data-kanban-column"),
    ).toBe("Done");
  });
  await press("n");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(input("Done"));
  });
  const keyResult1 = await press("ArrowLeft", { shiftKey: true });
  await vi.waitFor(() => {
    expect(keyResult1.defaultPrevented).toBe(false);
  });
  const keyResult2 = await press("n");
  await vi.waitFor(() => {
    expect(keyResult2.defaultPrevented).toBe(false);
  });
  await vi.waitFor(() => {
    expect(onMove).not.toHaveBeenCalled();
  });
});

it("keeps rapid moves visible and saves the second card after the first finishes", async () => {
  await using fixture = await setup();
  const { screen, Harness, card, focus, press } = fixture;
  const first = fixture.deferredMove();
  const second = fixture.deferredMove();
  const persistMove = vi.fn((id: string) => (id === "a" ? first.promise : second.promise));
  await act(async () => screen.rerender(<Harness persistMove={persistMove} />));
  await focus(card("a"));
  await press("ArrowRight", { shiftKey: true });
  await focus(card("b"));
  await press("ArrowRight", { shiftKey: true });
  await vi.waitFor(() => {
    expect(persistMove.mock.calls).toEqual([["a"]]);
  });
  for (const id of ["a", "b"]) {
    await vi.waitFor(() => {
      expect(card(id).closest("[data-kanban-column]")?.getAttribute("data-kanban-column")).toBe(
        "AI",
      );
    });
    await vi.waitFor(() => {
      expect(card(id).getAttribute("aria-disabled")).toBe("false");
    });
  }
  await act(async () => first.resolve(true));
  await vi.waitFor(() => {
    expect(persistMove.mock.calls).toEqual([["a"], ["b"]]);
  });
  await act(async () => second.resolve(true));
  for (const id of ["a", "b"]) {
    await vi.waitFor(() => {
      expect(card(id).closest("[data-kanban-column]")?.getAttribute("data-kanban-column")).toBe(
        "AI",
      );
    });
  }
});

it("continues queued moves after a failed save and rolls back only the failed move", async () => {
  await using fixture = await setup();
  const { screen, Harness, card, focus, press } = fixture;
  const first = fixture.deferredMove();
  const persistMove = vi.fn((id: string) => (id === "a" ? first.promise : Promise.resolve(true)));
  await act(async () => screen.rerender(<Harness persistMove={persistMove} />));
  await focus(card("a"));
  await press("ArrowRight", { shiftKey: true });
  await focus(card("b"));
  await press("ArrowRight", { shiftKey: true });
  await act(async () => first.resolve(false));
  await vi.waitFor(() => {
    expect(persistMove.mock.calls).toEqual([["a"], ["b"]]);
  });
  await vi.waitFor(() => {
    expect(card("a").closest("[data-kanban-column]")?.getAttribute("data-kanban-column")).toBe(
      "TODO",
    );
  });
  await vi.waitFor(() => {
    expect(card("b").closest("[data-kanban-column]")?.getAttribute("data-kanban-column")).toBe(
      "AI",
    );
  });
});

it("waits for the project update and uses its latest cards for the next move", async () => {
  await using fixture = await setup();
  const { screen, onOpen, onAdd, card, focus, press } = fixture;
  const first = fixture.deferredMove();
  const persist = vi
    .fn<(cards: KanbanCard[]) => Promise<boolean>>()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(true);
  const render = async (cards: KanbanCard[], busy: boolean) => {
    await act(async () =>
      screen.rerender(
        <KanbanBoard
          cards={cards}
          tags={[]}
          environmentId="remote"
          disabled={busy}
          moveDisabled={false}
          onAdd={onAdd}
          onOpen={onOpen}
          onDelete={() => {}}
          onMove={(id, column, index) => persist(reorderKanbanCard(cards, id, column, index))}
        />,
      ),
    );
  };
  await render(initialCards, false);
  await focus(card("a"));
  await press("ArrowRight", { shiftKey: true });
  await render(initialCards, true);
  await focus(card("b"));
  await press("ArrowRight", { shiftKey: true });
  await act(async () => first.resolve(true));
  await vi.waitFor(() => {
    expect(persist).toHaveBeenCalledTimes(1);
  });
  const updated = reorderKanbanCard(initialCards, "a", "AI", 0);
  await render(updated, false);
  await vi.waitFor(() => {
    expect(persist).toHaveBeenCalledTimes(2);
  });
  await vi.waitFor(() => {
    expect(
      persist.mock.calls[1]?.[0].filter((card) => card.column === "AI").map((card) => card.id),
    ).toEqual(["b", "a", "c", "d"]);
  });
});

it("leaves global shortcuts alone and prevents moving while saving or on repeat", async () => {
  await using fixture = await setup();
  const { screen, Harness, onMove, card, focus, press } = fixture;
  await focus(card("a"));
  const keyResult3 = await press("1", { metaKey: true });
  await vi.waitFor(() => {
    expect(keyResult3.defaultPrevented).toBe(false);
  });
  const keyResult4 = await press("ArrowRight", { ctrlKey: true });
  await vi.waitFor(() => {
    expect(keyResult4.defaultPrevented).toBe(false);
  });
  await press("ArrowRight", { shiftKey: true, repeat: true });
  await act(async () => screen.rerender(<Harness boardDisabled />));
  await press("ArrowRight", { shiftKey: true });
  await vi.waitFor(() => {
    expect(onMove).not.toHaveBeenCalled();
  });
  await press("ArrowDown");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("b"));
  });
});

it("opens with Enter and returns focus to the ticket after Escape", async () => {
  await using fixture = await setup();
  const { onOpen, card, focus, press } = fixture;
  await focus(card("b"));
  await press("Enter");
  await vi.waitFor(() => {
    expect(onOpen).toHaveBeenCalledWith("b");
  });
  await vi.waitFor(() => {
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
  await press("Escape");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("b"));
  });
});

it("allows adding on a completely empty board", async () => {
  await using fixture = await setup();
  const { screen, Harness, board, input, focus, press } = fixture;
  await act(async () => screen.rerender(<Harness key="empty" initial={[]} />));
  await focus(board());
  await press("ArrowRight");
  await press("n");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(input("AI"));
  });
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
  await using fixture = await setup();
  const { onMove, card, focus, press } = fixture;
  await focus(card("b"));
  await act(async () => card("b").blur());
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(document.body);
  });
  const keyResult5 = await press("ArrowDown");
  await vi.waitFor(() => {
    expect(keyResult5.defaultPrevented).toBe(true);
  });
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("b"));
  });
  await vi.waitFor(() => {
    expect(onMove).not.toHaveBeenCalled();
  });
  await press("ArrowDown", { shiftKey: true });
  await vi.waitFor(() => {
    expect(onMove).not.toHaveBeenCalled();
  });
});

it("returns from an add field with Escape without clearing its draft", async () => {
  await using fixture = await setup();
  const { card, input, focus, press } = fixture;
  await focus(card("b"));
  await press("n");
  const field = input("TODO");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(field, "Keep this draft");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await press("Escape");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("b"));
  });
  await vi.waitFor(() => {
    expect(field.value).toBe("Keep this draft");
  });
  await press("n");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(field);
  });
});

it("navigates from card actions and recovers focus after clicking column whitespace", async () => {
  await using fixture = await setup();
  const { container, card, focus, press } = fixture;
  await focus(card("b").querySelector<HTMLButtonElement>("button")!);
  await press("ArrowUp");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("a"));
  });
  const column = container.querySelector<HTMLElement>('[data-kanban-column="AI"]')!;
  await act(async () =>
    column.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true })),
  );
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("c"));
  });
});

it("does not recover board focus while ticket details or other controls own input", async () => {
  await using fixture = await setup();
  const { container, card, input, focus, press } = fixture;
  await focus(card("b"));
  await press("Enter");
  const keyResult6 = await press("ArrowDown", {}, document.body);
  await vi.waitFor(() => {
    expect(keyResult6.defaultPrevented).toBe(false);
  });
  await press("Escape");
  await focus(container.querySelector<HTMLButtonElement>("button")!);
  const keyResult7 = await press("ArrowDown");
  await vi.waitFor(() => {
    expect(keyResult7.defaultPrevented).toBe(false);
  });
  await focus(input("TODO"));
  const keyResult8 = await press("ArrowDown");
  await vi.waitFor(() => {
    expect(keyResult8.defaultPrevented).toBe(false);
  });
});

it("filters tickets and navigates only visible cards while preserving hidden order", async () => {
  await using fixture = await setup();
  const { screen, container, Harness, onMove, board, card, focus, press } = fixture;
  await act(async () =>
    screen.rerender(
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
  await vi.waitFor(() => {
    expect(card("b")).toBeNull();
  });
  await vi.waitFor(() => {
    expect(card("c")).toBeNull();
  });
  await press("Escape");
  await focus(board());
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("a"));
  });
  await press("ArrowDown");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("e"));
  });
  await press("ArrowUp", { shiftKey: true });
  await vi.waitFor(() => {
    expect(onMove).toHaveBeenLastCalledWith("e", "TODO", 0);
  });
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Clear tag filter"]')!.click(),
  );
  await vi.waitFor(() => {
    expect(
      Array.from(
        container.querySelectorAll('[data-kanban-column="TODO"] [data-kanban-card]'),
        (element) => (element as HTMLElement).dataset.kanbanCard,
      ),
    ).toEqual(["e", "a", "b"]);
  });
});

it("keeps tickets matching any checked tag and restores all tickets when unchecked", async () => {
  await using fixture = await setup();
  const { screen, container, Harness, card } = fixture;
  await act(async () =>
    screen.rerender(
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
  await vi.waitFor(() => {
    expect(card("a")).not.toBeNull();
  });
  await vi.waitFor(() => {
    expect(card("b")).not.toBeNull();
  });
  await vi.waitFor(() => {
    expect(card("c")).toBeNull();
  });
  await vi.waitFor(() => {
    expect(card("d")).toBeNull();
  });
  await vi.waitFor(() => {
    expect(option("bug").getAttribute("aria-selected")).toBe("true");
  });
  await act(async () => option("feature").click());
  await vi.waitFor(() => {
    expect(card("c")).not.toBeNull();
  });
  await vi.waitFor(() => {
    expect(container.querySelectorAll('[data-kanban-card="a"]')).toHaveLength(1);
  });
  await vi.waitFor(() => {
    expect(card("d")).toBeNull();
  });
  await act(async () => option("bug").click());
  await vi.waitFor(() => {
    expect(card("a")).not.toBeNull();
  });
  await vi.waitFor(() => {
    expect(card("b")).toBeNull();
  });
  await vi.waitFor(() => {
    expect(card("c")).not.toBeNull();
  });
  await act(async () => option("feature").click());
  await vi.waitFor(() => {
    expect(card("d")).not.toBeNull();
  });
  await vi.waitFor(() => {
    expect(container.querySelector('[aria-label="Clear tag filter"]')).toBeNull();
  });
});

it("filters titles, descriptions and branches across columns without changing the cards", async () => {
  await using fixture = await setup();
  const { screen, container, Harness, onMove, searchTickets } = fixture;
  await act(async () =>
    screen.rerender(
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
  await vi.waitFor(() => {
    expect(
      Array.from(container.querySelectorAll("[data-kanban-card]"), (el) =>
        el.getAttribute("data-kanban-card"),
      ),
    ).toEqual(["a", "b", "c"]);
  });
  for (const column of ["TODO", "AI", "Done"]) {
    await vi.waitFor(() => {
      expect(container.querySelector(`[data-kanban-column="${column}"] h2 span`)?.textContent).toBe(
        "1",
      );
    });
  }
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Clear ticket search"]')!.click(),
  );
  await vi.waitFor(() => {
    expect(container.querySelectorAll("[data-kanban-card]")).toHaveLength(4);
  });
  await searchTickets("   ");
  await vi.waitFor(() => {
    expect(container.querySelectorAll("[data-kanban-card]")).toHaveLength(4);
  });
  await vi.waitFor(() => {
    expect(onMove).not.toHaveBeenCalled();
  });
});

it("shows an empty search state and restores all tickets with Escape", async () => {
  await using fixture = await setup();
  const { container, focus, press, searchTickets } = fixture;
  const field = await searchTickets("no matching ticket");
  await vi.waitFor(() => {
    expect(container.querySelectorAll("[data-kanban-card]")).toHaveLength(0);
  });
  await vi.waitFor(() => {
    expect(container.querySelector('p[role="status"]')?.textContent).toContain("No tickets match");
  });
  await focus(field);
  const keyResult9 = await press("ArrowDown");
  await vi.waitFor(() => {
    expect(keyResult9.defaultPrevented).toBe(false);
  });
  await press("Escape");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(field);
  });
  await vi.waitFor(() => {
    expect(field.value).toBe("");
  });
  await vi.waitFor(() => {
    expect(container.querySelectorAll("[data-kanban-card]")).toHaveLength(4);
  });
  await vi.waitFor(() => {
    expect(container.querySelector('p[role="status"]')).toBeNull();
  });
});

it("navigates and reorders matching tickets using their positions in the full column", async () => {
  await using fixture = await setup();
  const { screen, container, Harness, onMove, board, card, focus, press, searchTickets } = fixture;
  await act(async () =>
    screen.rerender(
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
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("a"));
  });
  await press("ArrowDown");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("c"));
  });
  await press("ArrowUp");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("a"));
  });
  await press("ArrowDown", { shiftKey: true });
  await vi.waitFor(() => {
    expect(onMove).toHaveBeenLastCalledWith("a", "TODO", 2);
  });
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(card("a"));
  });
  await searchTickets("");
  await vi.waitFor(() => {
    expect(
      Array.from(container.querySelectorAll("[data-kanban-card]"), (el) =>
        el.getAttribute("data-kanban-card"),
      ),
    ).toEqual(["b", "c", "a", "d"]);
  });
});

it("combines ticket search with the selected tags", async () => {
  await using fixture = await setup();
  const { screen, container, Harness, card, press, searchTickets } = fixture;
  await act(async () =>
    screen.rerender(
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
  await vi.waitFor(() => {
    expect(card("a")).not.toBeNull();
  });
  await vi.waitFor(() => {
    expect(card("b")).toBeNull();
  });
  await vi.waitFor(() => {
    expect(card("c")).toBeNull();
  });
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Clear ticket search"]')!.click(),
  );
  await vi.waitFor(() => {
    expect(card("b")).not.toBeNull();
  });
  await vi.waitFor(() => {
    expect(card("c")).toBeNull();
  });
});
