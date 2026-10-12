import { useState } from "react";
import { XIcon } from "lucide-react";
import type { KanbanTag } from "@t3tools/contracts";
import { randomUUID } from "../lib/utils";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxInput,
  ComboboxPopup,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "./ui/combobox";

export function KanbanTagsEditor({
  tagIds,
  tags,
  onChange,
}: {
  tagIds: readonly string[];
  tags: readonly KanbanTag[];
  onChange: (tagIds: string[], tags: KanbanTag[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const name = query.trim();
  const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
  const available = tags.filter(
    (tag) => !tagIds.includes(tag.id) && tag.name.toLowerCase().includes(name.toLowerCase()),
  );
  const items = name && !existing ? [...available, { id: "", name }] : available;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="kanban-tag" className="text-sm font-medium">
        Tags
      </label>
      {tagIds.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {tagIds.map((id) => {
            const tag = tags.find((tag) => tag.id === id);
            return tag ? (
              <Button
                key={id}
                size="xs"
                variant="secondary"
                aria-label={`Remove tag ${tag.name}`}
                onClick={() =>
                  onChange(
                    tagIds.filter((existing) => existing !== id),
                    [...tags],
                  )
                }
              >
                {tag.name}
                <XIcon className="size-3" />
              </Button>
            ) : null;
          })}
        </div>
      ) : null}
      <Combobox
        items={items}
        filteredItems={items}
        filter={null}
        value={null}
        inputValue={query}
        onInputValueChange={setQuery}
        itemToStringLabel={(tag: KanbanTag) => tag.name}
        isItemEqualToValue={(a, b) => a.id === b.id}
        open={open}
        onOpenChange={setOpen}
        disabled={tagIds.length >= 10}
        onValueChange={(selected) => {
          if (!selected) return;
          const tag = selected.id ? selected : { id: randomUUID(), name: selected.name };
          onChange([...tagIds, tag.id], selected.id ? [...tags] : [...tags, tag]);
          setQuery("");
          setOpen(false);
        }}
      >
        <ComboboxInput
          id="kanban-tag"
          size="sm"
          placeholder="Choose or create a tag…"
          maxLength={40}
        />
        <ComboboxPopup>
          <ComboboxList>
            {(tag: KanbanTag) => (
              <ComboboxItem key={tag.id} value={tag}>
                {tag.id ? tag.name : `Create “${tag.name}”`}
              </ComboboxItem>
            )}
          </ComboboxList>
          <ComboboxEmpty>
            {existing && tagIds.includes(existing.id)
              ? "Tag already added."
              : "No tags yet. Type a name to create one."}
          </ComboboxEmpty>
        </ComboboxPopup>
      </Combobox>
      {tagIds.length >= 10 ? (
        <span className="text-xs text-muted-foreground">Maximum 10 tags per ticket.</span>
      ) : null}
    </div>
  );
}
