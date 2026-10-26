export function resolveThreadComposerPrimaryAction(input: {
  readonly hasContent: boolean;
  readonly latestTurnState: "completed" | "in_progress" | "error" | "interrupted" | null;
  readonly sessionStatus: "ready" | "starting" | "running" | "error" | "closed" | null;
}): "continue" | "send" | "stop" {
  if (
    !input.hasContent &&
    (input.sessionStatus === "running" || input.sessionStatus === "starting")
  ) {
    return "stop";
  }
  if (!input.hasContent && input.latestTurnState === "interrupted") {
    return "continue";
  }
  return "send";
}
