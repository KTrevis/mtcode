import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { CheckboxCombobox } from "./checkbox-combobox";

function Harness({ onOpen }: { readonly onOpen: (id: string) => void }) {
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
      <output aria-label="Selected dependencies">{selected.join(",")}</output>
    </>
  );
}

it("searches, toggles dependencies, and opens a ticket without toggling its checkbox", async () => {
  const onOpen = vi.fn();
  await using screen = await render(<Harness onOpen={onOpen} />);
  await userEvent.click(screen.getByLabelText("Select dependencies"));
  const selected = screen.getByRole("status", { name: "Selected dependencies" });
  const base = page.getByRole("option", { name: /Base/ });
  await userEvent.click(base);
  await expect.element(selected).toHaveTextContent("base");
  await userEvent.click(page.getByRole("button", { name: "Open Base" }));
  expect(onOpen).toHaveBeenCalledWith("base");
  await expect.element(selected).toHaveTextContent("base");
  await userEvent.click(base);
  await expect.element(selected).toBeEmptyDOMElement();
  await userEvent.click(page.getByRole("option", { name: /Cycle/ }), { force: true });
  await expect.element(selected).toBeEmptyDOMElement();
  await userEvent.type(page.getByPlaceholder("Search dependencies"), "api");
  await vi.waitFor(() => expect(page.getByRole("option").all()).toHaveLength(1));
  await expect.element(page.getByRole("option", { name: /API/ })).toBeVisible();
});
