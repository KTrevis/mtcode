import { expect, it } from "vite-plus/test";
import { EventId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { deriveMonitoringTasks } from "./monitoring.ts";

const row = (kind: string, payload: unknown, minute: number): OrchestrationThreadActivity => ({
  id: EventId.make(`${kind}:${minute}`),
  kind,
  payload,
  tone: "info",
  summary: "Monitor",
  turnId: null,
  createdAt: `2026-10-01T14:${String(minute).padStart(2, "0")}:00.000Z`,
});
it("keeps independent watches, clears consumed wake times and excludes completed and agent-owned tasks", () => {
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
  expect(
    deriveMonitoringTasks([started, process, completed, progress]).map((task) => task.id),
  ).toEqual(["server"]);
});
