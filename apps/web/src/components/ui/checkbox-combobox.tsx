import { useRef, useState, type ReactNode } from "react";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import {
  Combobox,
  ComboboxTrigger,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "./combobox";

export function CheckboxCombobox({
  items,
  selectedIds,
  onChange,
  triggerLabel,
  ariaLabel,
  searchPlaceholder,
  emptyMessage,
  onOpenItem,
  openingDisabled = false,
}: {
  items: readonly { id: string; label: string; description?: string; disabled?: boolean }[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  triggerLabel: ReactNode;
  ariaLabel: string;
  searchPlaceholder: string;
  emptyMessage: string;
  onOpenItem?: (id: string) => void;
  openingDisabled?: boolean;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const byId = new Map(items.map((item) => [item.id, item]));
  return (
    <div ref={anchorRef}>
      <Combobox
        multiple
        items={items.map((item) => item.id)}
        filteredItems={items
          .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
          .map((item) => item.id)}
        filter={null}
        value={[...selectedIds]}
        onValueChange={onChange}
        inputValue={query}
        onInputValueChange={setQuery}
        itemToStringLabel={(id) => byId.get(id)?.label ?? id}
        onOpenChange={(open) => {
          if (!open) setQuery("");
        }}
      >
        <ComboboxTrigger render={<Button size="sm" variant="outline" aria-label={ariaLabel} />}>
          {triggerLabel}
        </ComboboxTrigger>
        <ComboboxPopup anchor={anchorRef}>
          <ComboboxSearchInput aria-label={searchPlaceholder} placeholder={searchPlaceholder} />
          <ComboboxList>
            {(id: string) => {
              const item = byId.get(id)!;
              return (
                <ComboboxItem key={id} value={id} disabled={item.disabled}>
                  <span className="pointer-events-none flex items-center">
                    <Checkbox
                      checked={selectedIds.includes(id)}
                      readOnly
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                  </span>
                  {onOpenItem ? (
                    <button
                      type="button"
                      className="min-w-0 flex-1 cursor-pointer truncate rounded-sm text-left hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`Open ${item.label}`}
                      disabled={openingDisabled}
                      onPointerDown={(event) => event.stopPropagation()}
                      onMouseUp={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenItem(id);
                      }}
                    >
                      {item.label}
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  )}
                  {item.description ? (
                    <span className="text-xs text-muted-foreground">{item.description}</span>
                  ) : null}
                </ComboboxItem>
              );
            }}
          </ComboboxList>
          <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
        </ComboboxPopup>
      </Combobox>
    </div>
  );
}
