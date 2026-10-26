import { CheckIcon, PencilIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { type EnvironmentId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { Input } from "../ui/input";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Button } from "../ui/button";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "~/state/server";

function EnvironmentLabelControl({
  environmentId,
  label,
  environmentLabels,
  canRename,
  showValue = false,
  valueClassName = "text-sm text-muted-foreground",
  valueElement: ValueElement = "span",
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly environmentLabels: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }>;
  readonly canRename: boolean;
  readonly showValue?: boolean;
  readonly valueClassName?: string;
  readonly valueElement?: "span" | "h3";
}) {
  const renameEnvironment = useAtomCommand(serverEnvironment.updateEnvironmentLabel, {
    reportFailure: false,
  });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  const [saving, setSaving] = useState(false);
  const [pendingDuplicateLabel, setPendingDuplicateLabel] = useState<string | null>(null);

  if (!canRename && pendingDuplicateLabel !== null) setPendingDuplicateLabel(null);

  if (!canRename && !showValue) return null;

  const cancel = () => {
    setValue(label);
    setEditing(false);
  };
  const save = async (nextLabel: string) => {
    setSaving(true);
    const result = await renameEnvironment({ environmentId, input: nextLabel });
    setSaving(false);
    if (result._tag === "Success") {
      setEditing(false);
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not rename environment",
          description:
            error instanceof Error ? error.message : "The environment name was not saved.",
        }),
      );
    }
  };

  if (!editing || !canRename) {
    return (
      <>
        {showValue ? <ValueElement className={valueClassName}>{label}</ValueElement> : null}
        {canRename ? (
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label={`Rename ${label}`}
            onClick={() => {
              setValue(label);
              setEditing(true);
            }}
          >
            <PencilIcon className="size-3" />
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <>
      <form
        className="flex min-w-0 items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          const nextLabel = value.trim();
          const duplicate =
            nextLabel.length > 0 &&
            environmentLabels.some(
              (environment) =>
                environment.environmentId !== environmentId && environment.label === nextLabel,
            );
          if (duplicate) {
            setPendingDuplicateLabel(nextLabel);
            return;
          }
          void save(nextLabel);
        }}
      >
        <Input
          autoFocus
          size="compact"
          className="w-48"
          aria-label="Environment name"
          maxLength={40}
          value={value}
          disabled={saving}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }}
        />
        <Button size="icon-xs" type="submit" disabled={saving} aria-label="Save environment name">
          {saving ? <Spinner className="size-3" /> : <CheckIcon className="size-3" />}
        </Button>
        <Button
          size="icon-xs"
          type="button"
          variant="ghost"
          disabled={saving}
          aria-label="Cancel environment rename"
          onClick={cancel}
        >
          <XIcon className="size-3" />
        </Button>
      </form>
      <AlertDialog
        open={pendingDuplicateLabel !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDuplicateLabel(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Use this name twice?</AlertDialogTitle>
            <AlertDialogDescription>
              Another environment is already named “{pendingDuplicateLabel}”. Both environments will
              use the same name.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              type="button"
              onClick={() => {
                const nextLabel = pendingDuplicateLabel;
                setPendingDuplicateLabel(null);
                if (nextLabel !== null) void save(nextLabel);
              }}
            >
              Use name
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

export { EnvironmentLabelControl };
