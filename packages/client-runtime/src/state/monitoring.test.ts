import { expect, it } from "vite-plus/test";
import { EventId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { deriveMonitoringTasks, formatMonitoringDuration } from "./monitoring.ts";

const row = (kind: string, payload: unknown, minute: number): OrchestrationThreadActivity => ({
  id: EventId.make(`${kind}:${minute}`),
  kind,
  payload,
  tone: "info",
  summary: "Monitor",
  turnId: null,
  createdAt: `2026-10-01T14:${String(minute).padStart(2, "0")}:00.000Z`,
});
it("keeps independent watches and their durations, clears consumed wake times and excludes agent-owned tasks", () => {
  const started = row(
    "task.started",
    {
      taskId: "ci",
      taskType: "shell",
      detail: "watch-ci",
      monitoring: {
        label: "CI for PR #123",
        category: "scheduled",
        command: "watch-ci",
        nextWakeAt: "2026-10-01T14:35:00.000Z",
        stoppable: true,
      },
    },
    30,
  );
  const process = row(
    "task.started",
    { taskId: "server", taskType: "shell", detail: "vp run dev" },
    31,
  );
  const nested = row("task.started", { taskId: "nested", taskType: "shell", agentId: "agent" }, 32);
  expect(deriveMonitoringTasks([started, process, nested])).toMatchObject([
    {
      id: "ci",
      label: "CI for PR #123",
      category: "scheduled",
      nextWakeAt: "2026-10-01T14:35:00.000Z",
      stoppable: true,
    },
    { id: "server", category: "process", stoppable: false },
  ]);
  const progress = row("task.progress", { taskId: "ci", summary: "CI still running" }, 35);
  expect(deriveMonitoringTasks([process, progress, started])[0]).toMatchObject({
    nextWakeAt: undefined,
    result: { text: "CI still running" },
  });
  const completed = row("task.completed", { taskId: "ci", status: "stopped" }, 36);
  const tasks = deriveMonitoringTasks([started, process, completed, progress]);
  expect(tasks.map((task) => task.id)).toEqual(["server", "ci"]);
  expect(tasks[1]).toMatchObject({
    startedAt: started.createdAt,
    completedAt: completed.createdAt,
    status: "stopped",
    nextWakeAt: undefined,
  });
  expect(formatMonitoringDuration(tasks[1]!, Date.parse(row("", {}, 50).createdAt))).toBe("6m");
  expect(formatMonitoringDuration(tasks[0]!, Date.parse(completed.createdAt))).toBe("5m");
  expect(
    deriveMonitoringTasks([
      started,
      process,
      completed,
      row("task.completed", { taskId: "server" }, 40),
    ]).map((task) => task.id),
  ).toEqual(["server", "ci"]);
  expect(
    deriveMonitoringTasks([process, row("task.completed", { taskId: "server" }, 40)])[0],
  ).toMatchObject({ status: "completed", completedAt: row("", {}, 40).createdAt });
});

it.each(["completed", "failed", "stopped", "cancelled", "interrupted", "idle"])(
  "freezes duration on %s and starts a fresh duration when the task restarts",
  (status) => {
    const started = row("task.started", { taskId: "watch", taskType: "monitor" }, 10);
    const ended = row("task.progress", { taskId: "watch", status }, 12);
    const late = row("task.progress", { taskId: "watch", summary: "late update" }, 13);
    const duplicate = row("task.completed", { taskId: "watch" }, 14);
    const task = deriveMonitoringTasks([late, duplicate, ended, started])[0]!;
    expect(task).toMatchObject({
      startedAt: started.createdAt,
      completedAt: ended.createdAt,
      status,
    });
    expect(task.result).toBeUndefined();
    expect(formatMonitoringDuration(task, Date.parse(late.createdAt))).toBe("2m");
    const restarted = row("task.started", { taskId: "watch", taskType: "monitor" }, 15);
    const fresh = deriveMonitoringTasks([started, ended, restarted])[0]!;
    expect(fresh).toMatchObject({
      startedAt: restarted.createdAt,
    });
    expect(fresh.completedAt).toBeUndefined();
  },
);
