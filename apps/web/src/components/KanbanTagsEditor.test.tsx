// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import type { KanbanTag } from "@t3tools/contracts";
import { KanbanTagsEditor } from "./KanbanTagsEditor";

it("adds suggested tags without case duplicates and lets users remove them", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Harness() {
    const [tagIds, setTagIds] = useState<string[]>([]);
    const [tags, setTags] = useState<KanbanTag[]>([{ id: "frontend-id", name: "Frontend" }]);
    return (
      <>
        <KanbanTagsEditor
          tags={tags}
          tagIds={tagIds}
          onChange={(ids, nextTags) => {
            setTagIds(ids);
            setTags(nextTags);
          }}
        />
        <output data-tag-ids={tagIds.join(",")}>
          {tagIds.map((id) => tags.find((tag) => tag.id === id)?.name).join(",")}
        </output>
      </>
    );
  }
  try {
    await act(async () => root.render(<Harness />));
    const input = container.querySelector("input")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    const add = async (value: string, option: string) => {
      if (!container.querySelector('[data-slot="combobox-trigger"][aria-expanded="true"]')) {
        await act(async () =>
          container.querySelector<HTMLButtonElement>('[data-slot="combobox-trigger"]')!.click(),
        );
      }
      await act(async () => {
        setValue.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      });
      const item = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
        (element) => element.textContent === option,
      )!;
      expect(item).toBeDefined();
      await act(async () => item.click());
    };
    await add("frontend", "Frontend");
    expect(container.querySelector("output")!.textContent).toBe("Frontend");
    await act(async () => {
      setValue.call(input, "FRONTEND");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    });
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(container.querySelector("output")!.textContent).toBe("Frontend");
    await add("bug", "Create “bug”");
    expect(container.querySelector("output")!.textContent).toBe("Frontend,bug");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Remove tag Frontend"]')!.click(),
    );
    expect(container.querySelector("output")!.textContent).toBe("bug");
    await add("Front", "Frontend");
    expect(container.querySelector("output")!.getAttribute("data-tag-ids")!.split(",")[1]).toBe(
      "frontend-id",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
