// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { CheckboxCombobox } from "./checkbox-combobox";

it("searches, toggles dependencies, and opens a ticket without toggling its checkbox", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onOpen = vi.fn();
  function Harness() {
    const [selected, setSelected] = useState<string[]>([]);
    return (
      <>
        <CheckboxCombobox
          items={[
            { id: "base", label: "Base" },
            { id: "api", label: "API" },
            { id: "cycle", label: "Cycle", disabled: true },
          ]}
          selectedIds={selected}
          onChange={setSelected}
          onOpenItem={onOpen}
          triggerLabel="Dependencies"
          ariaLabel="Select dependencies"
          searchPlaceholder="Search dependencies"
          emptyMessage="No tickets found."
        />
        <output>{selected.join(",")}</output>
      </>
    );
  }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Select dependencies"]')!.click(),
    );
    const option = (label: string) =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
        (item) => item.textContent === label,
      )!;
    await act(async () => option("Base").querySelector<HTMLElement>('[role="checkbox"]')!.click());
    expect(container.querySelector("output")!.textContent).toBe("base");
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Open Base"]')!.click(),
    );
    expect(onOpen).toHaveBeenCalledWith("base");
    expect(container.querySelector("output")!.textContent).toBe("base");
    await act(async () => option("Base").click());
    expect(container.querySelector("output")!.textContent).toBe("");
    await act(async () => option("Cycle").click());
    expect(container.querySelector("output")!.textContent).toBe("");
    const input = document.querySelector<HTMLInputElement>('[aria-label="Search dependencies"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(input, "api");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(option("API")).toBeDefined();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
