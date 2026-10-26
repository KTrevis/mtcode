import {
  EventId,
  MessageId,
  OrchestrationV2ThreadDetailSnapshot,
  OrchestrationV2ThreadStreamItem,
  PiNativeSessionKey,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { projectPiThread } from "./PiSessionProjection.ts";
import { makePiV2StreamAdapter, piV2Detail, piV2Shell } from "./PiV2Projection.ts";
import type { PiEvent } from "./PiThreadModel.ts";

const isDetail = Schema.is(OrchestrationV2ThreadDetailSnapshot);
const isStreamItem = Schema.is(OrchestrationV2ThreadStreamItem);

const record = {
  sourceKey: PiNativeSessionKey.make("native-fixture"),
  threadId: ThreadId.make("external:pi:fixture"),
  canonicalFile: "/isolated/pi.jsonl",
  sessionId: "fixture",
  cwd: "/workspace",
  title: "native session",
  createdAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-15T00:01:00.000Z",
  fileSize: 1,
  fileMtimeMs: 1,
  historyTruncation: { truncated: false },
};
const entries = [
  {
    type: "message",
    id: "user",
    parentId: null,
    timestamp: record.createdAt,
    message: { role: "user", content: "inspect" },
  },
  {
    type: "message",
    id: "assistant",
    parentId: "user",
    timestamp: record.updatedAt,
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "done" },
        { type: "thinking", thinking: "check" },
        { type: "toolCall", id: "bash", name: "bash", arguments: { command: "pwd" } },
      ],
    },
  },
  {
    type: "message",
    id: "output",
    parentId: "assistant",
    timestamp: record.updatedAt,
    message: {
      role: "toolResult",
      toolName: "bash",
      toolCallId: "bash",
      content: [{ type: "text", text: "/workspace" }],
    },
  },
];
function snapshot() {
  return projectPiThread({ record, entries, projectId: ProjectId.make("project") });
}
describe("native Pi v2 projections", () => {
  it("folds native task lifecycle updates into one subagent item and clears pending work on completion", () => {
    const initial = snapshot();
    const base = {
      tone: "info" as const,
      summary: "worker",
      turnId: TurnId.make("fixture:user"),
      createdAt: record.updatedAt,
      payload: { taskId: "worker-1", detail: "inspect files" },
    };
    const running = {
      ...initial,
      thread: {
        ...initial.thread,
        activities: [
          ...initial.thread.activities,
          { ...base, id: EventId.make("worker-start"), kind: "task.started" },
        ],
      },
    };
    expect(piV2Shell(running).pendingBackgroundTasks).toMatchObject([
      { taskId: "worker-1", kind: "subagent", stoppable: false },
    ]);
    const completed = {
      ...running,
      thread: {
        ...running.thread,
        activities: [
          ...running.thread.activities,
          { ...base, id: EventId.make("worker-complete"), kind: "task.completed" },
        ],
      },
    };
    expect(
      piV2Detail(completed).projection.turnItems.filter((item) => item.type === "subagent"),
    ).toMatchObject([{ id: "pi-task:worker-1", status: "completed" }]);
    expect(piV2Shell(completed).pendingBackgroundTasks).toEqual([]);
  });

  it("projects history into schema-valid runs, messages and visible tool items", () => {
    const result = piV2Detail(snapshot());
    expect(isDetail(result)).toBe(true);
    expect(result.projection.runs).toMatchObject([
      { id: "fixture:user", status: "completed", userMessageId: "fixture:user" },
    ]);
    expect(result.projection.visibleTurnItems.map((row) => row.item.type)).toEqual([
      "user_message",
      "assistant_message",
      "reasoning",
      "command_execution",
    ]);
    expect(result.projection.turnItems.at(-1)).toMatchObject({
      input: "pwd",
      output: "/workspace",
      status: "completed",
    });
    expect(piV2Shell(snapshot())).toMatchObject({
      latestRunId: "fixture:user",
      latestVisibleMessage: { text: "done" },
      itemCount: 4,
    });
  });
  it("streams accumulated assistant text with stable item identity and resume sequence", () => {
    const adapt = makePiV2StreamAdapter();
    adapt({ kind: "snapshot", snapshot: snapshot() });
    const base = {
      aggregateKind: "thread",
      aggregateId: record.threadId,
      occurredAt: record.updatedAt,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
    } as const;
    const event = (sequence: number, text: string): PiEvent => ({
      ...base,
      sequence,
      eventId: EventId.make(`delta:${sequence}`),
      type: "thread.message-sent",
      payload: {
        threadId: record.threadId,
        messageId: MessageId.make("live"),
        role: "assistant",
        text,
        turnId: TurnId.make("fixture:user"),
        streaming: true,
        createdAt: record.updatedAt,
        updatedAt: record.updatedAt,
      },
    });
    const first = adapt({ kind: "event", event: event(10, "hello ") });
    const second = adapt({ kind: "event", event: event(11, "world") });
    expect(isStreamItem(first)).toBe(true);
    expect(isStreamItem(second)).toBe(true);
    expect(second).toMatchObject({
      kind: "event",
      sequence: 11,
      event: {
        type: "turn-item.updated",
        payload: { id: "live", text: "hello world", streaming: true },
      },
    });
  });
});
