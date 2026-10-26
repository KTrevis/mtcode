import type { ReactNode } from "react";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SearchOptionButton(props: {
  readonly active: boolean;
  readonly size?: "default" | "inline";
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-label={props.label}
            pressed={props.active}
            className={props.className}
            size={props.size === "inline" ? "searchInline" : "search"}
            disabled={props.disabled}
            variant="ghost"
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="top">{props.label}</TooltipPopup>
    </Tooltip>
  );
}
