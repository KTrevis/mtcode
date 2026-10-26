// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import { CommandId, MessageId, VoiceApiError, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";

const isVoiceApiError = Schema.is(VoiceApiError);

export const delegateVoiceRequest = Effect.fn("Voice.delegateRequest")(
  function* (
    threads: Pick<
      ThreadManagementService["Service"],
      "getThreadShell" | "sendToThread" | "waitForThread" | "getThreadSnapshotWindow"
    >,
    threadId: ThreadId,
    prompt: string,
  ) {
    const thread = yield* threads.getThreadShell(threadId);
    if (thread === null || thread.archivedAt !== null || thread.activeRunId !== null) {
      return yield* new VoiceApiError({
        reason: "upstream_unavailable",
        message: "Open an idle, active task before sending a voice request.",
      });
    }
    const sent = yield* threads.sendToThread({
      projectId: thread.projectId,
      commandId: CommandId.make(`voice:${NodeCrypto.randomUUID()}`),
      messageId: MessageId.make(NodeCrypto.randomUUID()),
      threadId,
      text: prompt,
      attachments: [],
      mode: "auto",
      createdBy: "user",
      creationSource: "web",
    });
    const completed = yield* threads.waitForThread({
      projectId: thread.projectId,
      threadId,
      runId: sent.run.id,
      timeoutMs: 300000,
    });
    if (completed.timedOut || completed.run?.status !== "completed") {
      return yield* new VoiceApiError({
        reason: "upstream_unavailable",
        message: "The agent did not complete the voice request.",
      });
    }
    const { projection } = yield* threads.getThreadSnapshotWindow(threadId, { rowLimit: 100 });
    return projection.messages
      .filter((message) => message.role === "assistant" && message.runId === sent.run.id)
      .map((message) => message.text)
      .join("\n");
  },
  Effect.mapError((cause) =>
    isVoiceApiError(cause)
      ? cause
      : new VoiceApiError({ reason: "upstream_unavailable", message: cause.message }),
  ),
);
