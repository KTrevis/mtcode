import {
  EventId,
  NodeId,
  ProviderInstanceId,
  ProviderDriverKind,
  RunId,
  TurnItemId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadDetailSnapshot,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2ThreadStreamItem,
  type OrchestrationV2TurnItem,
  MessageId,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import type {
  PiActivity,
  PiMessage,
  PiThreadSnapshot,
  PiThreadStreamItem,
} from "./PiThreadModel.ts";

const date = (value: string) => DateTime.makeUnsafe(value);
const runId = (value: TurnId | null) => (value === null ? null : RunId.make(value));
const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null ? (value as Readonly<Record<string, unknown>>) : {};
const string = (value: unknown) => (typeof value === "string" ? value : undefined);
const creation = { createdBy: "user", creationSource: "provider" } as const;

function itemBase(
  threadId: ThreadId,
  id: string,
  turnId: TurnId | null,
  timestamp: string,
  ordinal: number,
) {
  const at = date(timestamp);
  return {
    id: TurnItemId.make(id),
    threadId,
    runId: runId(turnId),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed" as const,
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
  };
}
function messageItem(
  threadId: ThreadId,
  message: PiMessage,
  ordinal: number,
): OrchestrationV2TurnItem {
  const base = {
    ...itemBase(threadId, message.id, message.turnId, message.createdAt, ordinal),
    updatedAt: date(message.updatedAt),
    status: message.streaming ? ("running" as const) : ("completed" as const),
    completedAt: message.streaming ? null : date(message.updatedAt),
  };
  return message.role === "user"
    ? {
        ...base,
        ...creation,
        type: "user_message",
        messageId: message.id,
        inputIntent: message.turnId === null ? "queued_turn" : "turn_start",
        text: message.text,
        attachments: [],
      }
    : {
        ...base,
        type: "assistant_message",
        messageId: message.id,
        text: message.text,
        streaming: message.streaming,
      };
}
const activityIdentity = (activity: PiActivity) =>
  activity.kind.startsWith("task.")
    ? `pi-task:${string(record(activity.payload).taskId) ?? activity.id}`
    : activity.id;

function activityItem(
  threadId: ThreadId,
  activity: PiActivity,
  ordinal: number,
): OrchestrationV2TurnItem {
  const payload = record(activity.payload),
    data = record(payload.data);
  const status =
    payload.status === "inProgress" ||
    activity.kind === "task.started" ||
    activity.kind === "task.progress"
      ? "running"
      : payload.status === "failed" || activity.tone === "error"
        ? "failed"
        : "completed";
  const base = {
    ...itemBase(threadId, activityIdentity(activity), activity.turnId, activity.createdAt, ordinal),
    title: activity.summary,
    status,
    completedAt: status === "running" ? null : date(activity.createdAt),
  } as const;
  if (activity.kind === "reasoning")
    return {
      ...base,
      type: "reasoning",
      text: string(payload.text) ?? "",
      streaming: status === "running",
    };
  if (activity.kind === "session.recap")
    return { ...base, type: "system_notice", message: string(payload.detail) ?? activity.summary };
  if (activity.kind.startsWith("task."))
    return {
      ...base,
      type: "subagent",
      subagentId: NodeId.make(string(payload.taskId) ?? activity.id),
      origin: "provider_native",
      driver: ProviderDriverKind.make("pi"),
      providerInstanceId: ProviderInstanceId.make("pi"),
      childThreadId: null,
      prompt: string(payload.detail) ?? string(payload.title) ?? activity.summary,
      progress: string(payload.summary) ?? string(payload.detail),
      result: status === "running" ? null : (string(payload.summary) ?? activity.summary),
    };
  const rawInput = record(data.rawInput),
    rawOutput = record(data.rawOutput);
  if (payload.itemType === "command_execution")
    return {
      ...base,
      type: "command_execution",
      input: string(data.command) ?? string(rawInput.command) ?? "",
      output: string(rawOutput.stdout) ?? string(rawOutput.content),
    };
  if (payload.itemType === "file_change" && typeof rawInput.path === "string")
    return { ...base, type: "file_change", fileName: rawInput.path };
  return {
    ...base,
    type: "dynamic_tool",
    toolName: string(data.toolName) ?? null,
    input: data.rawInput ?? payload,
    output: data.rawOutput,
  };
}

export function piV2Detail(snapshot: PiThreadSnapshot): OrchestrationV2ThreadDetailSnapshot {
  const native = snapshot.thread;
  const queuedMessages: PiMessage[] = (native.pendingComposerIntents ?? []).map(
    (intent, index) => ({
      id: MessageId.make(`${native.id}:queue:${index}`),
      role: "user",
      text: intent.text,
      turnId: null,
      streaming: false,
      createdAt: native.updatedAt,
      updatedAt: native.updatedAt,
    }),
  );
  const nativeMessages = [...native.messages, ...queuedMessages];
  const messages: OrchestrationV2ConversationMessage[] = nativeMessages.map((message) => ({
    ...creation,
    createdBy: message.role === "user" ? "user" : "agent",
    id: message.id,
    threadId: native.id,
    runId: runId(message.turnId),
    nodeId: null,
    role: message.role,
    text: message.text,
    attachments: [],
    streaming: message.streaming,
    createdAt: date(message.createdAt),
    updatedAt: date(message.updatedAt),
  }));
  const users = native.messages.filter(
    (message) => message.role === "user" && message.turnId !== null,
  );
  const runs: OrchestrationV2Run[] = users.map((message, index) => {
    const active =
      native.latestTurn?.turnId === message.turnId && native.session?.status === "running";
    const last = native.messages.findLast((candidate) => candidate.turnId === message.turnId);
    return {
      id: RunId.make(message.turnId!),
      threadId: native.id,
      ordinal: index + 1,
      providerInstanceId: native.modelSelection.instanceId,
      modelSelection: native.modelSelection,
      providerThreadId: null,
      userMessageId: message.id,
      rootNodeId: null,
      activeAttemptId: null,
      status: active ? "running" : "completed",
      requestedAt: date(message.createdAt),
      startedAt: date(message.createdAt),
      completedAt: active ? null : date(last?.updatedAt ?? message.updatedAt),
      checkpointId: null,
      contextHandoffId: null,
    };
  });
  const candidates = [
    ...nativeMessages.map((message) => ({
      at: message.createdAt,
      item: messageItem(native.id, message, 0),
    })),
    ...native.activities.map((activity) => ({
      at: activity.createdAt,
      item: activityItem(native.id, activity, 0),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const turnItems = [...new Map(candidates.map(({ item }) => [item.id, item])).values()].map(
    (item, ordinal) => ({ ...item, ordinal }),
  );
  const thread = {
    ...creation,
    id: native.id,
    projectId: native.projectId,
    title: native.title,
    providerInstanceId: native.modelSelection.instanceId,
    modelSelection: native.modelSelection,
    runtimeMode: native.runtimeMode,
    interactionMode: native.interactionMode,
    branch: native.branch,
    worktreePath: native.worktreePath,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: native.id },
    forkedFrom: null,
    createdAt: date(native.createdAt),
    updatedAt: date(native.updatedAt),
    archivedAt: null,
    settledOverride: native.settledOverride,
    settledAt: native.settledAt === null ? null : date(native.settledAt),
    lastVisitedAt: null,
    deletedAt: null,
    backing: native.backing,
    historyTruncation: native.historyTruncation,
  };
  return {
    snapshotSequence: snapshot.snapshotSequence,
    projection: {
      thread,
      runs,
      attempts: [],
      nodes: [],
      subagents: [],
      providerSessions: [],
      providerThreads: [],
      providerTurns: [],
      runtimeRequests: [],
      messages,
      plans: [],
      turnItems,
      checkpointScopes: [],
      checkpoints: [],
      contextHandoffs: [],
      contextTransfers: [],
      visibleTurnItems: turnItems.map((item, position) => ({
        position,
        visibility: "local",
        sourceThreadId: native.id,
        sourceItemId: item.id,
        item,
      })),
      updatedAt: date(native.updatedAt),
    },
  };
}

export function piV2Shell(snapshot: PiThreadSnapshot): OrchestrationV2ThreadShell {
  const { projection } = piV2Detail(snapshot),
    latest = projection.runs.at(-1),
    active = projection.runs.findLast((run) => run.status === "running"),
    message = projection.messages.at(-1);
  return {
    ...projection.thread,
    latestRunId: latest?.id ?? runId(snapshot.thread.latestTurn?.turnId ?? null),
    activeRunId:
      active?.id ??
      (snapshot.thread.session?.status === "running"
        ? runId(snapshot.thread.latestTurn?.turnId ?? null)
        : null),
    status: active || snapshot.thread.session?.status === "running" ? "running" : "idle",
    latestRunRequestedAt:
      latest?.requestedAt ??
      (snapshot.thread.latestTurn ? date(snapshot.thread.latestTurn.requestedAt) : null),
    latestRunStartedAt:
      latest?.startedAt ??
      (snapshot.thread.latestTurn?.startedAt ? date(snapshot.thread.latestTurn.startedAt) : null),
    latestRunCompletedAt:
      latest?.completedAt ??
      (snapshot.thread.latestTurn?.completedAt
        ? date(snapshot.thread.latestTurn.completedAt)
        : null),
    pendingRuntimeRequest: null,
    latestVisibleMessage: message
      ? { id: message.id, role: message.role, text: message.text, updatedAt: message.updatedAt }
      : null,
    latestUserMessageAt:
      projection.messages.findLast((item) => item.role === "user")?.createdAt ?? null,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: projection.turnItems.flatMap((item) =>
      item.type === "subagent" && item.status === "running"
        ? [
            {
              kind: "subagent" as const,
              taskId: item.subagentId,
              description: item.progress ?? item.prompt,
              providerInstanceId: item.providerInstanceId,
              stoppable: false,
              ...(item.startedAt ? { startedAt: item.startedAt } : {}),
            },
          ]
        : [],
    ),
    providerInstanceHistory: [projection.thread.providerInstanceId],
    itemCount: projection.turnItems.length,
    visibleItemCount: projection.visibleTurnItems.length,
  };
}

export function makePiV2StreamAdapter() {
  const items = new Map<string, OrchestrationV2TurnItem>();
  return (input: PiThreadStreamItem): OrchestrationV2ThreadStreamItem => {
    if (input.kind === "synchronized") return input;
    if (input.kind === "snapshot") {
      const snapshot = piV2Detail(input.snapshot);
      items.clear();
      for (const item of snapshot.projection.turnItems) items.set(item.id, item);
      return { kind: "snapshot", ...snapshot };
    }
    const event = input.event;
    if (event.type === "thread.session-set") return { kind: "synchronized" };
    let item: OrchestrationV2TurnItem;
    if (event.type === "thread.message-sent") {
      const { messageId, threadId: _, ...message } = event.payload;
      const previous = items.get(messageId);
      item = messageItem(
        event.aggregateId,
        {
          ...message,
          id: messageId,
          text:
            message.streaming && previous?.type === "assistant_message"
              ? previous.text + message.text
              : message.text,
        },
        previous?.ordinal ?? items.size,
      );
    } else {
      const activity = event.payload.activity,
        previous = items.get(activityIdentity(activity));
      item = activityItem(event.aggregateId, activity, previous?.ordinal ?? items.size);
    }
    items.set(item.id, item);
    return {
      kind: "event",
      sequence: event.sequence,
      event: {
        id: EventId.make(event.eventId),
        threadId: event.aggregateId,
        occurredAt: date(event.occurredAt),
        type: "turn-item.updated",
        payload: item,
      },
    };
  };
}
