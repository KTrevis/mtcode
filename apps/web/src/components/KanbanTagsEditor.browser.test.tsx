import { useState } from "react";
import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import type { KanbanTag } from "@t3tools/contracts";
import { render } from "../../test/render";
import { KanbanTagsEditor } from "./KanbanTagsEditor";

it("adds suggested tags without case duplicates and lets users remove them", async () => {
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
        <output data-testid="selected-tags" data-tag-ids={tagIds.join(",")}>
          {tagIds.map((id) => tags.find((tag) => tag.id === id)?.name).join(",")}
        </output>
      </>
    );
  }
  await using screen = await render(<Harness />);
  const input = screen.getByRole("combobox");
  await input.fill("frontend");
  await page.getByRole("option", { name: "Frontend", exact: true }).click();
  await expect.element(screen.getByTestId("selected-tags")).toHaveTextContent("Frontend");
  await input.fill("FRONTEND");
  await expect.element(page.getByRole("option")).not.toBeInTheDocument();
  await expect.element(screen.getByTestId("selected-tags")).toHaveTextContent("Frontend");
  await input.fill("bug");
  await page.getByRole("option", { name: "Create “bug”", exact: true }).click();
  await expect.element(screen.getByTestId("selected-tags")).toHaveTextContent("Frontend,bug");
  await screen.getByRole("button", { name: "Remove tag Frontend" }).click();
  await expect.element(screen.getByTestId("selected-tags")).toHaveTextContent("bug");
  await input.fill("Front");
  await page.getByRole("option", { name: "Frontend", exact: true }).click();
  await expect
    .element(screen.getByTestId("selected-tags"))
    .toHaveAttribute("data-tag-ids", expect.stringMatching(/,frontend-id$/));
});
