import type { OrchestrationV2ProviderGoalStatus } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useThreadShells } from "../state/entities";

const TOAST_ON_STATUS = {
  complete: "success",
  blocked: "error",
  usage_limited: "warning",
} as const satisfies Partial<
  Record<OrchestrationV2ProviderGoalStatus, "success" | "error" | "warning">
>;

type ToastableGoalStatus = keyof typeof TOAST_ON_STATUS;

function isToastableGoalStatus(status: string): status is ToastableGoalStatus {
  return status in TOAST_ON_STATUS;
}

// Watches every Thread shell's Goal and raises a toast when one settles into a state the user should hear about (complete, blocked, usage-limited).
export function GoalStatusToastCoordinator() {
  const threads = useThreadShells();
  const seenStatusesRef = useRef<ReadonlyMap<string, string>>(new Map());

  // oxlint-disable-next-line t3code/react-effect-budget -- Emit notifications for externally completed or blocked objectives.
  useEffect(() => {
    const previousStatuses = seenStatusesRef.current;
    const nextStatuses = new Map<string, string>();
    for (const thread of threads) {
      const goal = thread.goal;
      if (goal == null) {
        continue;
      }
      const key = `${thread.environmentId}:${thread.id}`;
      nextStatuses.set(key, goal.status);
      const previousStatus = previousStatuses.get(key);
      if (
        previousStatus === undefined ||
        previousStatus === goal.status ||
        !isToastableGoalStatus(goal.status)
      ) {
        continue;
      }
      toastManager.add(
        stackedThreadToast({
          type: TOAST_ON_STATUS[goal.status],
          title: `Objective ${goal.status.replaceAll("_", " ").toLowerCase()}`,
          description: goal.objective,
        }),
      );
    }
    seenStatusesRef.current = nextStatuses;
  }, [threads]);

  return null;
}
