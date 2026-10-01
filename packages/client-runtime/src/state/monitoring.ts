import {
  MonitoringMetadata,
  MONITOR_TASK_TYPES,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export interface MonitoringTask {
  readonly id: string;
  readonly label: string;
  readonly category: "scheduled" | "event" | "process";
  readonly command: string;
  readonly nextWakeAt?: string | undefined;
  readonly stoppable: boolean;
  readonly result?: { readonly at: string; readonly text: string };
}

const decodeMonitoringMetadata = Schema.decodeUnknownOption(MonitoringMetadata);

export const monitoringCategoryLabel = {
  scheduled: "Scheduled wait",
  event: "Event watch",
  process: "Background process",
} as const;

/** Fold the task journal, including providers that only publish a command. */
export function deriveMonitoringTasks(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): MonitoringTask[] {
  const tasks = new Map<string, MonitoringTask>();
  const terminal = new Set<string>();
  for (const activity of [...activities].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const payload = activity.payload;
    if (
      !payload ||
      typeof payload !== "object" ||
      !("taskId" in payload) ||
      typeof payload.taskId !== "string"
    )
      continue;
    const id = payload.taskId;
    if (
      activity.kind === "task.completed" ||
      ("status" in payload &&
        ["completed", "failed", "stopped", "cancelled", "interrupted", "idle"].includes(
          String(payload.status),
        ))
    ) {
      terminal.add(id);
      tasks.delete(id);
      continue;
    }
    if (
      activity.kind === "task.started" &&
      "taskType" in payload &&
      typeof payload.taskType === "string" &&
      MONITOR_TASK_TYPES.has(payload.taskType) &&
      !("agentId" in payload && payload.agentId)
    ) {
      terminal.delete(id);
      const metadata =
        "monitoring" in payload ? decodeMonitoringMetadata(payload.monitoring) : undefined;
      const detail =
        "detail" in payload && typeof payload.detail === "string"
          ? payload.detail
          : activity.summary;
      const info = metadata?._tag === "Some" ? metadata.value : undefined;
      tasks.set(id, {
        id,
        label: info?.label ?? detail,
        command: info?.command ?? detail,
        category: info?.category ?? (payload.taskType === "monitor" ? "event" : "process"),
        stoppable: info?.stoppable ?? false,
        ...(info?.nextWakeAt ? { nextWakeAt: info.nextWakeAt } : {}),
      });
    } else if (activity.kind === "task.progress" && !terminal.has(id)) {
      const task = tasks.get(id);
      if (task && "summary" in payload && typeof payload.summary === "string") {
        tasks.set(id, {
          ...task,
          nextWakeAt: undefined,
          result: { at: activity.createdAt, text: payload.summary },
        });
      }
    }
  }
  return Array.from(tasks.values());
}
