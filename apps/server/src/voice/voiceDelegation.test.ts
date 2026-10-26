import { expect, it } from "@effect/vitest";
import { ProjectId, RunId, ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { delegateVoiceRequest } from "./voiceDelegation.ts";

type VoiceThreads = Parameters<typeof delegateVoiceRequest>[0];
const threadId = ThreadId.make("voice-thread");
const runId = RunId.make("voice-run");

const makeThreads = (overrides: Partial<VoiceThreads> = {}): VoiceThreads => ({
  getThreadShell: () =>
    Effect.succeed({
      id: threadId,
      projectId: ProjectId.make("project"),
      archivedAt: null,
      activeRunId: null,
    } as unknown as OrchestrationV2ThreadShell),
  sendToThread: () =>
    Effect.succeed({ run: { id: runId } } as unknown as Effect.Success<
      ReturnType<ThreadManagementService["Service"]["sendToThread"]>
    >),
  waitForThread: () =>
    Effect.succeed({
      threadId,
      run: { id: runId, status: "completed" },
      timedOut: false,
    } as unknown as Effect.Success<
      ReturnType<ThreadManagementService["Service"]["waitForThread"]>
    >),
  getThreadSnapshotWindow: () =>
    Effect.succeed({
      projection: {
        messages: [
          { role: "assistant", runId: RunId.make("previous"), text: "Old answer" },
          { role: "user", runId, text: "Question" },
          { role: "assistant", runId, text: "Current answer" },
        ],
      },
    } as unknown as Effect.Success<
      ReturnType<ThreadManagementService["Service"]["getThreadSnapshotWindow"]>
    >),
  ...overrides,
});

it.effect("speaks only the answer from the request's completed run", () =>
  Effect.gen(function* () {
    expect(yield* delegateVoiceRequest(makeThreads(), threadId, "Question")).toBe("Current answer");
  }),
);

it.effect("refuses a busy thread before dispatching a voice request", () =>
  Effect.gen(function* () {
    const failure = yield* delegateVoiceRequest(
      makeThreads({
        getThreadShell: () =>
          Effect.succeed({ archivedAt: null, activeRunId: runId } as OrchestrationV2ThreadShell),
        sendToThread: () => Effect.die("A busy thread must not receive voice work"),
      }),
      threadId,
      "Question",
    ).pipe(Effect.flip);
    expect(failure.reason).toBe("upstream_unavailable");
  }),
);

it.effect("reports an incomplete run instead of reading an unrelated answer", () =>
  Effect.gen(function* () {
    const failure = yield* delegateVoiceRequest(
      makeThreads({
        waitForThread: () => Effect.succeed({ threadId, run: null, timedOut: true }),
        getThreadSnapshotWindow: () =>
          Effect.die("A timed out voice request must not read stale answers"),
      }),
      threadId,
      "Question",
    ).pipe(Effect.flip);
    expect(failure.message).toBe("The agent did not complete the voice request.");
  }),
);
