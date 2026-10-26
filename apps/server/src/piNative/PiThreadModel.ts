import type {
  ChatAttachment,
  CommandId,
  EventId,
  ExternalThreadBacking,
  ExternalThreadHistoryTruncation,
  MessageId,
  ModelSelection,
  OrchestrationMessageContext,
  ProjectId,
  ProviderInstanceId,
  RuntimeMode,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

export interface PiMessage {
  readonly id: MessageId;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly turnId: TurnId | null;
  readonly streaming: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly attachments?: ReadonlyArray<ChatAttachment>;
}
export interface PiActivity {
  readonly id: EventId;
  readonly tone: "info" | "error" | "tool";
  readonly kind: string;
  readonly summary: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly turnId: TurnId | null;
  readonly createdAt: string;
  readonly sequence?: number;
}
export interface PiSession {
  readonly threadId: ThreadId;
  readonly status: "running" | "starting" | "ready" | "stopped";
  readonly providerName: "pi";
  readonly providerInstanceId: ProviderInstanceId;
  readonly runtimeMode: RuntimeMode;
  readonly activeTurnId: TurnId | null;
  readonly lastError: string | null;
  readonly updatedAt: string;
}
export interface PiTurn {
  readonly turnId: TurnId;
  readonly state: "running" | "completed";
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly assistantMessageId: MessageId | null;
}
export interface PiThread {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: "full-access";
  readonly interactionMode: "default";
  readonly branch: null;
  readonly worktreePath: string;
  readonly latestTurn: PiTurn | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: null;
  readonly settledOverride: "settled" | "active" | null;
  readonly settledAt: string | null;
  readonly snoozedUntil: null;
  readonly snoozedAt: null;
  readonly deletedAt: null;
  readonly messages: ReadonlyArray<PiMessage>;
  readonly proposedPlans: readonly [];
  readonly activities: ReadonlyArray<PiActivity>;
  readonly checkpoints: readonly [];
  readonly pullRequests: readonly [];
  readonly session: PiSession | null;
  readonly backing: ExternalThreadBacking;
  readonly historyTruncation: ExternalThreadHistoryTruncation;
  readonly pendingComposerIntents?: ReadonlyArray<{
    readonly behavior: "steer" | "followUp";
    readonly text: string;
  }>;
  readonly pendingComposerIntentOmittedCount?: number;
}
export interface PiThreadSnapshot {
  readonly snapshotSequence: number;
  readonly thread: PiThread;
}
interface PiEventBase {
  readonly sequence: number;
  readonly eventId: EventId;
  readonly aggregateId: ThreadId;
  readonly aggregateKind: "thread";
  readonly occurredAt: string;
  readonly commandId: null;
  readonly causationEventId: null;
  readonly correlationId: null;
  readonly metadata: Readonly<Record<string, unknown>>;
}
export type PiEvent = PiEventBase &
  (
    | {
        readonly type: "thread.session-set";
        readonly payload: { readonly threadId: ThreadId; readonly session: PiSession };
      }
    | {
        readonly type: "thread.message-sent";
        readonly payload: Omit<PiMessage, "id"> & {
          readonly threadId: ThreadId;
          readonly messageId: MessageId;
        };
      }
    | {
        readonly type: "thread.activity-appended";
        readonly payload: { readonly threadId: ThreadId; readonly activity: PiActivity };
      }
  );
export type PiThreadStreamItem =
  | { readonly kind: "synchronized" }
  | { readonly kind: "snapshot"; readonly snapshot: PiThreadSnapshot }
  | { readonly kind: "event"; readonly event: PiEvent };
export type PiCommand =
  | {
      readonly type: "thread.turn.start";
      readonly commandId: CommandId;
      readonly threadId: ThreadId;
      readonly message: {
        readonly messageId: MessageId;
        readonly text: string;
        readonly context?: OrchestrationMessageContext | undefined;
        readonly attachments: ReadonlyArray<ChatAttachment>;
      };
      readonly externalResume?: "takeover";
      readonly streamingBehavior?: "steer" | "followUp";
    }
  | {
      readonly type:
        | "thread.turn.interrupt"
        | "thread.session.stop"
        | "thread.settle"
        | "thread.unsettle";
      readonly commandId: CommandId;
      readonly threadId: ThreadId;
    };
export interface PiDispatchResult {
  readonly sequence: number;
  readonly deliveryStatus: "completed" | "indeterminate";
}
